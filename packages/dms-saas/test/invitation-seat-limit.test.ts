import { createRequire } from "node:module";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { ImplementInterface } from "@antelopejs/interface-core";
import {
  GetModel,
  RegisterSchema,
} from "@antelopejs/interface-database-decorators";
import { construct, destroy } from "@antelopejs/mongodb";
import {
  TenantMemberModel,
  TenantModel,
  type UserInvite,
  UserInviteModel,
} from "@antelopejs/interface-dms/db";
import * as auth from "@antelopejs/interface-dms/auth";
import * as clientBaseUrl from "@antelopejs/interface-dms/client-base-url";
import {
  completeInviteResolution,
  decideInvite,
} from "@antelopejs/interface-dms/invite-resolution";
import { ExecuteHooks, Hook } from "@antelopejs/interface-dms/hooks";
import { createUserInviteToken } from "@antelopejs/interface-dms/invites";
import { applyTenantOwnership } from "@antelopejs/interface-dms/tenant-ownership";
import { UserModel, type User } from "@antelopejs/interface-dms/auth/db";
import { MongoMemoryReplSet } from "mongodb-memory-server-core";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { setRuntimeConfig } from "../src/config";
import { PlanModel, TenantSubscriptionModel } from "../src/db";
import { getSeatUsage, registerSeatHooks } from "../src/plans";
import { SaasWorkspacesListController } from "../src/pages/platform/workspaces";
import { SaasWorkspacesController } from "../src/routes/tenant/workspaces";
import {
  resendInvitation,
  resolveInvitationLink,
} from "../src/workspaces/invitations";

vi.mock("../src/billing-state", () => ({
  recomputeTenantBillingState: async () => undefined,
}));
vi.mock("../src/stripe/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/stripe/client")>()),
  getStripeClient: () => fakeStripe,
}));
vi.mock("../src/data-api", async () => ({
  ...(await import("../src/data-api/platformOwner/plans")),
  ...(await import("../src/data-api/platformOwner/workspaces")),
}));

/**
 * A Free workspace holds a single seat, taken by its pending owner
 * invitation. Reissuing that invitation, renewing its link or accepting it
 * must keep fitting in that seat; only a second invitee is over the cap.
 */

const require = createRequire(import.meta.url);
const dmsRoot = path.dirname(require.resolve("@antelopejs/dms/package.json"));
const DAY_MS = 86_400_000;
const SEAT_LIMIT_ERROR = { body: "saas.errors.plan.seat_limit_reached" };
const STRIPE_SUBSCRIPTION_ID = "sub_seat_billed";
const billedQuantities: number[] = [];
const fakeStripe = {
  subscriptions: {
    retrieve: async () => ({ items: { data: [{ id: "si_seats" }] } }),
    update: async (_id: string, params: { items: { quantity: number }[] }) => {
      billedQuantities.push(params.items[0]!.quantity);
    },
  },
};
let mongodb: MongoMemoryReplSet;

const operator = {
  _id: randomUUID(),
  email: "operator@example.test",
  name: "Olivia Operator",
  owner: true,
  language: "en",
} as User;

beforeAll(async () => {
  const modules = require("@antelopejs/interface-core/modules");
  ImplementInterface(
    { ListModules: modules.ListModules },
    { ListModules: async () => ["@antelopejs/dms-saas"] },
  );
  await require("@antelopejs/interface-dms/utils/saas-mode").detectSaasMode();
  const { applyConfig } = require(path.join(dmsRoot, "dist/config.js"));
  applyConfig({ auth: { jwtSecret: "invitation-seat-limit-test-only" } });
  const implementation = require(
    path.join(dmsRoot, "dist/implementations/dms-auth/index.js"),
  );
  ImplementInterface(auth, {
    ...implementation,
    sendAdminInviteEmail: async () => undefined,
  });
  ImplementInterface(clientBaseUrl, {
    GetClientBaseUrl: () => "https://console.example.test",
  });
  mongodb = await MongoMemoryReplSet.create({
    replSet: { count: 1 },
    binary: { version: "8.0.8" },
  });
  await construct({ url: mongodb.getUri(), database: "invitation-seats" });
  await RegisterSchema("dms-core");
  await RegisterSchema("dms-tenant");
  setRuntimeConfig({
    stripe: { secretKey: "unused", webhookSecret: "", publishableKey: "" },
  });
  registerSeatHooks();
}, 60_000);

afterAll(async () => {
  await destroy();
  await mongodb?.stop();
});

async function insertSingleSeatPlan(): Promise<string> {
  const planId = randomUUID();
  await GetModel(PlanModel).insert({
    _id: planId,
    name: "Free",
    price: 0,
    maxMembers: 1,
    isActive: true,
    isDeleted: false,
  });
  return planId;
}

async function createFreeWorkspace() {
  const controller = new SaasWorkspacesListController();
  controller.planModel = GetModel(PlanModel);
  controller.tenantModel = GetModel(TenantModel);
  const email = `${randomUUID()}@example.test`;
  const created = await controller.createWorkspace(operator, {
    name: "Free workspace",
    ownerEmail: email,
    planId: await insertSingleSeatPlan(),
    freeWorkspace: true,
  });
  if (created.owner.kind !== "invited") throw new Error("Expected invitation");
  return {
    email,
    tenantId: created.tenantId,
    inviteId: created.owner.inviteId,
  };
}

async function pendingInvites(tenantId: string): Promise<UserInvite[]> {
  return GetModel(UserInviteModel, tenantId).getAll();
}

async function insertUser(email: string, isPlatformOwner = false) {
  const userId = randomUUID();
  await GetModel(UserModel).insert({
    _id: userId,
    email,
    name: "Invitee",
    language: "en",
    owner: isPlatformOwner,
  });
  return userId;
}

async function insertPlatformOwner(): Promise<User> {
  const email = `${randomUUID()}@platform.test`;
  const user = await GetModel(UserModel).get(await insertUser(email, true));
  if (!user) throw new Error("Expected the platform owner");
  return user;
}

async function joinAsMember(platformOwner: User, tenantId: string) {
  const controller = new SaasWorkspacesController();
  controller.tenantModel = GetModel(TenantModel);
  controller.userModel = GetModel(UserModel);
  return controller.joinAsMember(platformOwner, tenantId);
}

function inviteAnotherMember(tenantId: string) {
  return createUserInviteToken({
    tenantId,
    email: `${randomUUID()}@example.test`,
    language: "en",
    roleIds: [],
    asTenantOwner: false,
  });
}

describe("seats held by invitations at the plan cap", () => {
  it("lets the pending owner invitation be resent", async () => {
    const { email, tenantId, inviteId } = await createFreeWorkspace();

    const { invite } = await resendInvitation(tenantId, inviteId);

    expect(invite._id).not.toBe(inviteId);
    expect(await pendingInvites(tenantId)).toEqual([
      expect.objectContaining({ _id: invite._id, email }),
    ]);
  });

  it("lets the link of an expired owner invitation be renewed", async () => {
    const { tenantId, inviteId } = await createFreeWorkspace();
    await GetModel(UserInviteModel, tenantId).update(inviteId, {
      expiresAt: new Date(Date.now() - DAY_MS),
    });

    const { expiresAt } = await resolveInvitationLink(tenantId, inviteId);

    expect(expiresAt.getTime()).toBeGreaterThan(Date.now());
    expect(await pendingInvites(tenantId)).toHaveLength(1);
  });

  it("lets the invited owner accept the invitation", async () => {
    const { email, tenantId, inviteId } = await createFreeWorkspace();
    const userId = await insertUser(email);
    const [invite] = await pendingInvites(tenantId);
    if (invite?._id !== inviteId) throw new Error("Expected the invitation");

    await completeInviteResolution(
      await decideInvite({ tenantId, invite, reason: "accepted", userId }),
    );

    const member = await GetModel(TenantMemberModel, tenantId).getByUser(
      userId,
    );
    expect(member).toBeDefined();
    expect(await pendingInvites(tenantId)).toHaveLength(0);
  });

  it("refuses to invite a second member", async () => {
    const { tenantId } = await createFreeWorkspace();

    await expect(inviteAnotherMember(tenantId)).rejects.toMatchObject(
      SEAT_LIMIT_ERROR,
    );
    expect(await pendingInvites(tenantId)).toHaveLength(1);
  });

  it("refuses to add a member outside the pending invitation", async () => {
    const { tenantId } = await createFreeWorkspace();
    const userId = await insertUser(`${randomUUID()}@example.test`);

    await expect(
      applyTenantOwnership(GetModel(UserModel), userId, tenantId, {
        roleIds: [],
        isTenantOwner: false,
      }),
    ).rejects.toMatchObject(SEAT_LIMIT_ERROR);
  });

  it("counts an invitation mid-reissue as a single seat", async () => {
    const { tenantId } = await createFreeWorkspace();
    const [invite] = await pendingInvites(tenantId);
    if (!invite) throw new Error("Expected the invitation");
    await GetModel(UserInviteModel, tenantId).insert({
      ...invite,
      _id: randomUUID(),
      token: randomUUID(),
    });

    expect(await getSeatUsage(tenantId)).toMatchObject({
      pendingInvites: 1,
      occupied: 1,
    });
  });
});

describe("platform owners supporting a full workspace", () => {
  it("lets a platform owner join without taking a seat", async () => {
    const { tenantId } = await createFreeWorkspace();
    const platformOwner = await insertPlatformOwner();

    await expect(joinAsMember(platformOwner, tenantId)).resolves.toEqual({
      joined: true,
    });

    expect(await getSeatUsage(tenantId)).toEqual({
      members: 0,
      pendingInvites: 1,
      occupied: 1,
      platformSupport: [
        {
          userId: platformOwner._id,
          name: platformOwner.name,
          email: platformOwner.email,
        },
      ],
    });
  });

  it("lets a platform owner be invited without taking a seat", async () => {
    const { tenantId } = await createFreeWorkspace();
    const platformOwner = await insertPlatformOwner();

    await createUserInviteToken({
      tenantId,
      email: platformOwner.email,
      language: "en",
      roleIds: [],
      asTenantOwner: false,
    });

    expect(await pendingInvites(tenantId)).toHaveLength(2);
    expect(await getSeatUsage(tenantId)).toMatchObject({
      pendingInvites: 1,
      occupied: 1,
    });
  });

  it("still refuses a customer member once a platform owner joined", async () => {
    const { tenantId } = await createFreeWorkspace();
    await joinAsMember(await insertPlatformOwner(), tenantId);

    await expect(inviteAnotherMember(tenantId)).rejects.toMatchObject(
      SEAT_LIMIT_ERROR,
    );
  });
});

describe("seats billed for invitations", () => {
  async function createSeatBilledWorkspace() {
    const workspace = await createFreeWorkspace();
    const subscriptions = GetModel(TenantSubscriptionModel, workspace.tenantId);
    const subscription = await subscriptions.findOne();
    if (!subscription) throw new Error("Expected a subscription");
    await subscriptions.update(subscription._id, {
      stripeSubscriptionId: STRIPE_SUBSCRIPTION_ID,
    });
    await GetModel(PlanModel).update(subscription.planId!, {
      billingMode: "seat",
    });
    billedQuantities.length = 0;
    return workspace;
  }

  async function resolveOwnerInvite(
    tenantId: string,
    reason: "accepted" | "cancelled",
    userId?: string,
  ): Promise<void> {
    const [invite] = await pendingInvites(tenantId);
    if (!invite) throw new Error("Expected the invitation");
    await completeInviteResolution(
      await decideInvite({ tenantId, invite, reason, userId }),
    );
  }

  it("keeps billing one seat while the invitation is resent", async () => {
    const { tenantId, inviteId } = await createSeatBilledWorkspace();

    await resendInvitation(tenantId, inviteId);

    expect(billedQuantities).toEqual([1, 1]);
  });

  it("bills the seat once the invitation turns into a member", async () => {
    const { email, tenantId } = await createSeatBilledWorkspace();

    await resolveOwnerInvite(tenantId, "accepted", await insertUser(email));

    expect(billedQuantities).toEqual([1]);
  });

  it("never bills a platform owner joining or leaving", async () => {
    const { tenantId } = await createSeatBilledWorkspace();
    const platformOwner = await insertPlatformOwner();

    await joinAsMember(platformOwner, tenantId);
    await ExecuteHooks(Hook.MEMBER_REMOVED, {
      tenantId,
      userIds: [platformOwner._id],
    });

    expect(billedQuantities).toEqual([1]);
  });

  it("releases the seat of a cancelled invitation", async () => {
    const { tenantId } = await createSeatBilledWorkspace();

    await resolveOwnerInvite(tenantId, "cancelled");

    expect(billedQuantities).toEqual([0]);
  });
});
