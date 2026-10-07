import { createRequire } from "node:module";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { HTTPResult } from "@antelopejs/interface-api";
import { ImplementInterface } from "@antelopejs/interface-core";
import {
  GetModel,
  RegisterSchema,
} from "@antelopejs/interface-database-decorators";
import { construct, destroy } from "@antelopejs/mongodb";
import {
  TenantModel,
  type UserInvite,
  UserInviteModel,
} from "@antelopejs/interface-dms/db";
import * as auth from "@antelopejs/interface-dms/auth";
import * as saasMode from "@antelopejs/interface-dms/utils/saas-mode";
import * as clientBaseUrl from "@antelopejs/interface-dms/client-base-url";
import { applyTenantOwnership } from "@antelopejs/interface-dms/tenant-ownership";
import { UserModel, type User } from "@antelopejs/interface-dms/auth/db";
import { MongoMemoryReplSet } from "mongodb-memory-server-core";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { setRuntimeConfig } from "../src/config";
import { PlanModel, TenantSubscriptionModel } from "../src/db";
import { OperatorActionModel } from "../src/operator-actions/db/operator-action.model";
import { invitationsDataAPI } from "../src/data-api/platformOwner/invitations";
import { loadDirectoryOwner } from "../src/billing-state/directory";
import { SaasWorkspaceDetailController } from "../src/routes/platformOwner/workspace-detail";
import { SaasWorkspacesAdminController } from "../src/routes/platformOwner/workspaces-admin";
import { SaasWorkspaceInvitationsController } from "../src/routes/platformOwner/workspace-invitations";

vi.mock("../src/billing-state", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/billing-state")>()),
  recomputeTenantBillingState: async () => undefined,
}));
vi.mock("../src/data-api", async () => ({
  ...(await import("../src/data-api/platformOwner/plans")),
  ...(await import("../src/data-api/platformOwner/workspaces")),
}));

const require = createRequire(import.meta.url);
const dmsRoot = path.dirname(require.resolve("@antelopejs/dms/package.json"));
const CONSOLE_URL = "https://console.example.test";
const DAY_MS = 86_400_000;
const sendInviteEmail =
  vi.fn<
    (
      email: string,
      token: string,
      inviteeName?: string,
      context?: auth.AdminInviteEmailContext,
    ) => Promise<void>
  >();
let mongodb: MongoMemoryReplSet;

beforeAll(async () => {
  // DMS answers isSaasMode() from the registrations it holds, so wire its
  // implementation in and declare SaaS mode the way construct() does.
  ImplementInterface(
    saasMode,
    require(path.join(dmsRoot, "dist/implementations/dms/saas-mode.js")),
  );
  saasMode.RegisterSaasMode();
  const { applyConfig } = require(path.join(dmsRoot, "dist/config.js"));
  applyConfig({ auth: { jwtSecret: "owner-invitations-test-only" } });
  const implementation = require(
    path.join(dmsRoot, "dist/implementations/dms-auth/index.js"),
  );
  ImplementInterface(auth, {
    ...implementation,
    sendAdminInviteEmail: sendInviteEmail,
  });
  ImplementInterface(clientBaseUrl, { GetClientBaseUrl: () => CONSOLE_URL });
  mongodb = await MongoMemoryReplSet.create({
    replSet: { count: 1 },
    binary: { version: "8.0.8" },
  });
  await construct({ url: mongodb.getUri(), database: "owner-invitations" });
  await RegisterSchema("dms-core");
  await RegisterSchema("dms-tenant");
}, 60_000);

afterAll(async () => {
  await destroy();
  await mongodb?.stop();
});

beforeEach(() => {
  sendInviteEmail.mockReset();
  sendInviteEmail.mockResolvedValue(undefined);
  setRuntimeConfig({
    stripe: { secretKey: "unused", webhookSecret: "", publishableKey: "" },
  });
});

const WORKSPACE_NAME = "Invited workspace";

const operator = {
  _id: randomUUID(),
  email: "operator@example.test",
  name: "Olivia Operator",
  owner: true,
  language: "en",
} as User;

function adminController(): SaasWorkspacesAdminController {
  const controller = new SaasWorkspacesAdminController();
  controller.planModel = GetModel(PlanModel);
  controller.tenantModel = GetModel(TenantModel);
  controller.userModel = GetModel(UserModel);
  return controller;
}

function invitationsController(): SaasWorkspaceInvitationsController {
  const controller = new SaasWorkspaceInvitationsController();
  controller.tenantModel = GetModel(TenantModel);
  return controller;
}

async function insertPlan(): Promise<string> {
  const planId = randomUUID();
  await GetModel(PlanModel).insert({
    _id: planId,
    name: "Assigned",
    price: 0,
    isActive: true,
    isDeleted: false,
  });
  return planId;
}

async function createWorkspaceFor(ownerEmail: string, by: User = operator) {
  return adminController().createWorkspace(by, {
    name: WORKSPACE_NAME,
    ownerEmail,
    planId: await insertPlan(),
    access: "complimentary",
  });
}

async function createInvitedWorkspace() {
  const email = `${randomUUID()}@example.test`;
  const created = await createWorkspaceFor(email);
  if (created.owner.kind !== "invited") throw new Error("Expected invitation");
  return { email, tenantId: created.tenantId, owner: created.owner };
}

async function storedInvite(tenantId: string): Promise<UserInvite> {
  const [invite] = await GetModel(UserInviteModel, tenantId).getAll();
  if (!invite) throw new Error("Expected a stored invitation");
  return invite;
}

async function journalFor(tenantId: string) {
  const actions = await GetModel(OperatorActionModel).getBy(
    "tenantId",
    tenantId,
  );
  return actions.filter((action) => action.action.startsWith("invitation."));
}

function signupLinkOf(invite: Pick<UserInvite, "token" | "email">): string {
  const params = new URLSearchParams({
    token: invite.token,
    email: invite.email,
  });
  return `${CONSOLE_URL}/auth/signup?${params.toString()}`;
}

describe("back-office workspace creation for a new owner", () => {
  it("reports a delivered invitation email and invites the owner as tenant owner", async () => {
    const { email, tenantId, owner } = await createInvitedWorkspace();
    const created = await GetModel(UserInviteModel, tenantId).get(
      owner.inviteId,
    );

    expect(sendInviteEmail).toHaveBeenCalledWith(
      email,
      owner.token,
      undefined,
      {
        workspaceName: WORKSPACE_NAME,
        inviterName: "Olivia Operator",
        language: "en",
      },
    );
    expect(created).toMatchObject({ email, asTenantOwner: true });
  });

  it("writes the invitation in the stored invitation language", async () => {
    const email = `${randomUUID()}@example.test`;
    const frenchOperator = { ...operator, language: "fr" } as User;

    const created = await createWorkspaceFor(email, frenchOperator);

    expect((await storedInvite(created.tenantId)).language).toBe("fr");
    expect(sendInviteEmail).toHaveBeenCalledWith(
      email,
      expect.any(String),
      undefined,
      expect.objectContaining({ language: "fr" }),
    );
  });

  it("leaves the inviter unnamed when the operator has no name", async () => {
    const email = `${randomUUID()}@example.test`;
    const namelessOperator = { ...operator, name: " " } as User;

    await createWorkspaceFor(email, namelessOperator);

    expect(sendInviteEmail).toHaveBeenCalledWith(
      email,
      expect.any(String),
      undefined,
      expect.objectContaining({
        workspaceName: WORKSPACE_NAME,
        inviterName: undefined,
      }),
    );
  });

  it("surfaces a failed invitation email instead of reporting success", async () => {
    sendInviteEmail.mockRejectedValue(new Error("render failed: 401"));
    const email = `${randomUUID()}@example.test`;

    const created = await createWorkspaceFor(email);

    expect(created.invitationEmail).toBe("failed");
    expect(created.owner.kind).toBe("invited");
    expect(await storedInvite(created.tenantId)).toMatchObject({ email });
  });

  it("sends no invitation when the owner already has an account", async () => {
    const email = `${randomUUID()}@example.test`;
    await GetModel(UserModel).insert({
      _id: randomUUID(),
      email,
      name: "Existing",
      language: "en",
    });

    const created = await createWorkspaceFor(email);

    expect(created.owner.kind).toBe("added");
    expect(created.invitationEmail).toBeNull();
    expect(sendInviteEmail).not.toHaveBeenCalled();
  });
});

describe("workspace owner in the directory", () => {
  it("shows the invitee while the owner invitation is pending", async () => {
    const { email, tenantId } = await createInvitedWorkspace();

    expect(await loadDirectoryOwner(tenantId)).toEqual({
      status: "invited",
      name: null,
      email,
    });
  });

  it("flags an owner invitation that can no longer be redeemed", async () => {
    const { email, tenantId, owner } = await createInvitedWorkspace();
    await GetModel(UserInviteModel, tenantId).update(owner.inviteId, {
      expiresAt: new Date(Date.now() - DAY_MS),
    });

    expect(await loadDirectoryOwner(tenantId)).toEqual({
      status: "expired",
      name: null,
      email,
    });
  });

  it("shows the owner once they joined", async () => {
    const { tenantId } = await createInvitedWorkspace();
    const ownerId = randomUUID();
    await GetModel(UserModel).insert({
      _id: ownerId,
      email: "joined@example.test",
      name: "Joined",
      language: "en",
    });
    await applyTenantOwnership(GetModel(UserModel), ownerId, tenantId, {
      roleIds: [],
      isTenantOwner: true,
    });

    expect(await loadDirectoryOwner(tenantId)).toEqual({
      status: "joined",
      name: "Joined",
      email: "joined@example.test",
    });
  });

  it("shows no owner when there is neither an owner nor an owner invitation", async () => {
    const [tenantId] = await GetModel(TenantModel).insert([
      { name: "Orphan", createdAt: new Date(), updatedAt: new Date() },
    ]);

    expect(await loadDirectoryOwner(tenantId!)).toEqual({
      status: "none",
      name: null,
      email: null,
    });
  });
});

describe("pending invitations listed on the workspace detail", () => {
  it("reports whether each invitation can still be redeemed", () => {
    const statusOf = (expiresAt: Date): boolean =>
      Object.getOwnPropertyDescriptor(
        invitationsDataAPI.prototype,
        "status",
      )!.get!.call({ table: { expiresAt } });

    expect(statusOf(new Date(Date.now() + DAY_MS))).toBe(true);
    expect(statusOf(new Date(Date.now() - DAY_MS))).toBe(false);
  });

  it("counts the owner invitation beside the members in the detail header", async () => {
    const { tenantId } = await createInvitedWorkspace();

    const overview = await new SaasWorkspaceDetailController().overview(
      operator,
      tenantId,
    );

    expect(overview).toMatchObject({
      members: 0,
      pendingInvitations: 1,
      ownerStatus: "invited",
    });
  });

  it("leaves an expired invitation out of the pending count", async () => {
    const { tenantId, owner } = await createInvitedWorkspace();
    await GetModel(UserInviteModel, tenantId).update(owner.inviteId, {
      expiresAt: new Date(Date.now() - DAY_MS),
    });

    const overview = await new SaasWorkspaceDetailController().overview(
      operator,
      tenantId,
    );

    expect(overview.pendingInvitations).toBe(0);
  });
});

describe("copy invitation link", () => {
  it("hands over the link the email carries and journals the disclosure", async () => {
    const { tenantId, owner } = await createInvitedWorkspace();
    const invite = await storedInvite(tenantId);

    const result = await invitationsController().copyLink(
      operator,
      tenantId,
      owner.inviteId,
    );

    expect(result.link).toBe(signupLinkOf(invite));
    const [journaled] = await journalFor(tenantId);
    expect(journaled).toMatchObject({
      action: "invitation.link_copy",
      actorId: operator._id,
      actorEmail: operator.email,
      status: "succeeded",
      details: { inviteId: owner.inviteId },
    });
    expect(JSON.stringify(journaled!.details)).not.toContain(invite.token);
  });

  it("renews an expired invitation so the link can still be redeemed", async () => {
    const { tenantId, owner } = await createInvitedWorkspace();
    await GetModel(UserInviteModel, tenantId).update(owner.inviteId, {
      expiresAt: new Date(Date.now() - DAY_MS),
    });

    const result = await invitationsController().copyLink(
      operator,
      tenantId,
      owner.inviteId,
    );

    const renewed = await storedInvite(tenantId);
    expect(renewed.token).not.toBe(owner.token);
    expect(renewed.asTenantOwner).toBe(true);
    expect(renewed.expiresAt.getTime()).toBeGreaterThan(Date.now());
    expect(result.link).toBe(signupLinkOf(renewed));
  });

  it("rejects an unknown invitation", async () => {
    const { tenantId } = await createInvitedWorkspace();

    await expect(
      invitationsController().copyLink(operator, tenantId, randomUUID()),
    ).rejects.toMatchObject({ body: "saas.errors.invitations.not_found" });
  });
});

describe("resend invitation from the back office", () => {
  it("reissues the invitation and emails the new link", async () => {
    const { email, tenantId, owner } = await createInvitedWorkspace();
    sendInviteEmail.mockClear();

    const result = await invitationsController().resend(
      operator,
      tenantId,
      owner.inviteId,
    );

    const renewed = await storedInvite(tenantId);
    expect(result.emailDelivery).toBe("sent");
    expect(renewed.token).not.toBe(owner.token);
    expect(sendInviteEmail).toHaveBeenCalledWith(
      email,
      renewed.token,
      undefined,
      {
        workspaceName: WORKSPACE_NAME,
        inviterName: "Olivia Operator",
        language: renewed.language,
      },
    );
  });

  it("keeps the renewed invitation but reports an email that did not leave", async () => {
    const { tenantId, owner } = await createInvitedWorkspace();
    sendInviteEmail.mockRejectedValue(new Error("smtp down"));

    const failure = await invitationsController()
      .resend(operator, tenantId, owner.inviteId)
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(HTTPResult);
    expect(failure).toMatchObject({
      body: "saas.errors.invitations.email_not_sent",
    });
    expect((await storedInvite(tenantId)).token).not.toBe(owner.token);
    const [journaled] = await journalFor(tenantId);
    expect(journaled).toMatchObject({
      action: "invitation.resend",
      details: { emailDelivery: "failed" },
    });
  });
});

async function insertPaidPlan(): Promise<string> {
  const planId = randomUUID();
  await GetModel(PlanModel).insert({
    _id: planId,
    name: "Pro",
    price: 29,
    currency: "eur",
    interval: "month",
    billingMode: "flat",
    audience: "any",
    paymentProviderRefs: { stripePriceId: "price_pro" },
    isActive: true,
    isDeleted: false,
  });
  return planId;
}

async function subscriptionOf(tenantId: string) {
  return GetModel(TenantSubscriptionModel, tenantId).findOne();
}

describe("access model of a workspace created by an operator", () => {
  it("leaves the workspace waiting for its owner's first payment on the chosen plan", async () => {
    const planId = await insertPaidPlan();

    const created = await adminController().createWorkspace(operator, {
      name: WORKSPACE_NAME,
      ownerEmail: `${randomUUID()}@example.test`,
      planId,
      access: "owner_pays",
    });

    expect(created.access).toBe("owner_pays");
    expect(await subscriptionOf(created.tenantId)).toMatchObject({
      planId,
      status: "pending_payment",
      isComplimentary: false,
      freeUntil: null,
      stripeSubscriptionId: null,
    });
  });

  it("refuses to let an owner pay for a plan Stripe does not bill", async () => {
    const failure = await adminController()
      .createWorkspace(operator, {
        name: WORKSPACE_NAME,
        ownerEmail: `${randomUUID()}@example.test`,
        planId: await insertPlan(),
        access: "owner_pays",
      })
      .catch((error: unknown) => error);

    expect(failure).toMatchObject({
      status: 400,
      body: "saas.errors.workspace_create.owner_pays_needs_paid_plan",
    });
  });

  it("grants complimentary access until the chosen date", async () => {
    const freeUntil = new Date(Date.now() + 30 * DAY_MS);

    const created = await adminController().createWorkspace(operator, {
      name: WORKSPACE_NAME,
      ownerEmail: `${randomUUID()}@example.test`,
      planId: await insertPaidPlan(),
      access: "complimentary",
      freeUntil: freeUntil.toISOString(),
    });

    expect(await subscriptionOf(created.tenantId)).toMatchObject({
      status: "active",
      isComplimentary: true,
      freeUntil,
    });
  });

  it("requires the operator to choose the access model", async () => {
    const failure = await adminController()
      .createWorkspace(operator, {
        name: WORKSPACE_NAME,
        ownerEmail: `${randomUUID()}@example.test`,
        planId: await insertPlan(),
      })
      .catch((error: unknown) => error);

    expect(failure).toMatchObject({
      status: 400,
      body: "saas.errors.workspace_create.access",
    });
  });
});

describe("owner e-mail lookup", () => {
  it("names an existing account and the workspaces it belongs to", async () => {
    const email = `${randomUUID()}@example.test`;
    await GetModel(UserModel).insert({
      _id: randomUUID(),
      email,
      name: "Nina Sharp",
      language: "en",
    });

    await expect(
      adminController().lookUpOwnerEmail(operator, email.toUpperCase()),
    ).resolves.toEqual({ kind: "existing", name: "Nina Sharp", workspaces: 0 });
  });

  it("announces an invitation for a new e-mail", async () => {
    await expect(
      adminController().lookUpOwnerEmail(
        operator,
        `${randomUUID()}@example.test`,
      ),
    ).resolves.toEqual({ kind: "new", invitationDays: 7 });
  });
});

describe("complimentary access over a paid subscription", () => {
  it("is refused until the operator acknowledges the cancellation", async () => {
    const { tenantId } = await createInvitedWorkspace();
    const subscription = await subscriptionOf(tenantId);
    await GetModel(TenantSubscriptionModel, tenantId).update(
      subscription!._id,
      { stripeSubscriptionId: "sub_paid", isComplimentary: false },
    );

    const failure = await adminController()
      .grantFreeAccess(operator, tenantId, { planId: await insertPaidPlan() })
      .catch((error: unknown) => error);

    expect(failure).toMatchObject({
      status: 400,
      body: "saas.errors.workspace.cancellation_not_acknowledged",
    });
  });
});
