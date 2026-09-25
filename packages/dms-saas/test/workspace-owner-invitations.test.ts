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
import { PlanModel } from "../src/db";
import { OperatorActionModel } from "../src/operator-actions/db/operator-action.model";
import { workspaceOwnerLabel } from "../src/data-api/platformOwner/workspaces";
import { invitationsDataAPI } from "../src/data-api/platformOwner/invitations";
import { SaasWorkspacesListController } from "../src/pages/platform/workspaces";
import { SaasWorkspaceInvitationsController } from "../src/routes/platformOwner/workspace-invitations";

vi.mock("../src/billing-state", () => ({
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
  vi.fn<(email: string, token: string) => Promise<void>>();
let mongodb: MongoMemoryReplSet;

beforeAll(async () => {
  const modules = require("@antelopejs/interface-core/modules");
  ImplementInterface(
    { ListModules: modules.ListModules },
    { ListModules: async () => ["@antelopejs/dms-saas"] },
  );
  await require("@antelopejs/interface-dms/utils/saas-mode").detectSaasMode();
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

const operator = {
  _id: randomUUID(),
  email: "operator@example.test",
  owner: true,
  language: "en",
} as User;

function listController(): SaasWorkspacesListController {
  const controller = new SaasWorkspacesListController();
  controller.planModel = GetModel(PlanModel);
  controller.tenantModel = GetModel(TenantModel);
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

async function createWorkspaceFor(ownerEmail: string) {
  return listController().createWorkspace(operator, {
    name: "Invited workspace",
    ownerEmail,
    planId: await insertPlan(),
    freeWorkspace: true,
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

    expect(sendInviteEmail).toHaveBeenCalledWith(email, owner.token, undefined);
    expect(created).toMatchObject({ email, asTenantOwner: true });
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

describe("workspace owner column", () => {
  it("names the invitee while the owner invitation is pending", async () => {
    const { email, tenantId } = await createInvitedWorkspace();

    expect(await workspaceOwnerLabel(tenantId)).toBe(
      `pending invitation · ${email}`,
    );
  });

  it("names the owners once one has joined", async () => {
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

    expect(await workspaceOwnerLabel(tenantId)).toBe("joined@example.test");
  });

  it("shows no owner when there is neither an owner nor an owner invitation", async () => {
    const [tenantId] = await GetModel(TenantModel).insert([
      { name: "Orphan", createdAt: new Date(), updatedAt: new Date() },
    ]);

    expect(await workspaceOwnerLabel(tenantId!)).toBe("—");
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
