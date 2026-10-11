import { randomUUID } from "node:crypto";
import { Schema } from "@antelopejs/interface-database";
import {
  GetModel,
  RegisterSchema,
} from "@antelopejs/interface-database-decorators";
import {
  CORE_SCHEMA_NAME,
  TENANT_SCHEMA_NAME,
} from "@antelopejs/interface-dms/constants";
import { TenantMemberModel, TenantModel } from "@antelopejs/interface-dms/db";
import {
  SessionModel,
  type User,
  UserExternalIdentityModel,
  UserModel,
} from "@antelopejs/interface-dms/auth/db";
import { construct, destroy } from "@antelopejs/mongodb";
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
import {
  InvoiceModel,
  type SegmentConditionGroup,
  SegmentModel,
  TenantBillingStateModel,
  UserSegmentModel,
} from "../src/db";

const seatSync = vi.hoisted(() => vi.fn(async () => undefined));
const notify = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock("../src/plans/seat-hooks", () => ({
  syncSeatsAfterChange: seatSync,
}));
vi.mock("../src/notifications", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/notifications")>()),
  notifyAllPlatformOwners: notify,
}));

import {
  createSegment,
  duplicateSegment,
  evaluateSegment,
  previewSegment,
  saveSegment,
} from "../src/segments";
import { SaasPlatformOwnersController } from "../src/routes/platformOwner/platform-owners";
import {
  loadUserDetail,
  loadUserSegmentMatches,
  sumPaidInvoices,
} from "../src/users";

const VERIFIED: SegmentConditionGroup = {
  logical: "and",
  conditions: [{ field: "isValidated", operator: "eq", value: true }],
};
const PAST_DUE_OWNERS: SegmentConditionGroup = {
  logical: "and",
  conditions: [
    {
      kind: "workspaceRef",
      quantifier: "any",
      role: "owner",
      conditions: {
        logical: "and",
        conditions: [{ field: "status", operator: "in", value: ["past_due"] }],
      },
    },
  ],
};

let mongo: MongoMemoryReplSet;

beforeAll(async () => {
  mongo = await MongoMemoryReplSet.create({
    replSet: { count: 1 },
    binary: { version: "8.0.8" },
  });
  await construct({ url: mongo.getUri(), database: "operator-users" });
  await RegisterSchema(CORE_SCHEMA_NAME);
  await RegisterSchema(TENANT_SCHEMA_NAME);
}, 120_000);

afterAll(async () => {
  await destroy();
  await mongo?.stop();
});

beforeEach(async () => {
  seatSync.mockClear();
  notify.mockClear();
  for (const model of [
    UserModel,
    TenantModel,
    SessionModel,
    UserExternalIdentityModel,
    SegmentModel,
    UserSegmentModel,
    TenantBillingStateModel,
  ]) {
    await GetModel(model).table.delete().run();
  }
});

async function insertUser(patch: Partial<User> = {}): Promise<User> {
  const _id = randomUUID();
  await GetModel(UserModel).insert({
    _id,
    email: `${_id}@example.test`,
    name: `User ${_id.slice(0, 4)}`,
    language: "en",
    owner: false,
    isValidated: true,
    ...patch,
  });
  return (await GetModel(UserModel).get(_id))!;
}

interface WorkspaceFixture {
  name: string;
  owner: User;
  members?: User[];
  billingState?: "active" | "past_due";
}

async function insertWorkspace(fixture: WorkspaceFixture): Promise<string> {
  const tenantId = randomUUID();
  await Schema.get(TENANT_SCHEMA_NAME)!.createInstance(tenantId).run();
  await GetModel(TenantModel).insert({
    _id: tenantId,
    name: fixture.name,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  const members = GetModel(TenantMemberModel, tenantId);
  await members.insert([
    {
      userId: fixture.owner._id,
      isTenantOwner: true,
      roleIds: [],
      joinedAt: new Date(),
    },
    ...(fixture.members ?? []).map((member) => ({
      userId: member._id,
      isTenantOwner: false,
      roleIds: [],
      joinedAt: new Date(),
    })),
  ]);
  await GetModel(TenantBillingStateModel).upsertForTenant(
    tenantId,
    fixture.billingState ?? "active",
  );
  return tenantId;
}

describe("segments saved from the editor", () => {
  it("evaluates a new segment and records its first count", async () => {
    await insertUser();
    await insertUser({ isValidated: false });

    const created = await createSegment({
      name: "Verified",
      description: "",
      conditions: VERIFIED,
    });
    const stored = await GetModel(SegmentModel).get(created._id);

    expect(created).toMatchObject({
      estimatedCount: 1,
      evaluationFailed: false,
    });
    expect(stored?.countHistory).toHaveLength(1);
    expect(stored?.countHistory?.[0]?.count).toBe(1);
    expect(typeof stored?.lastEvaluationMs).toBe("number");
  });

  it("saves only the fields an edit sends, then re-evaluates", async () => {
    await insertUser();
    const created = await createSegment({
      name: "Verified",
      description: "Kept",
      conditions: VERIFIED,
    });
    await insertUser();

    const saved = await saveSegment(created._id, { name: "Renamed" });
    const stored = await GetModel(SegmentModel).get(created._id);

    expect(saved.estimatedCount).toBe(2);
    expect(stored).toMatchObject({
      name: "Renamed",
      description: "Kept",
      conditions: VERIFIED,
    });
  });

  it("re-evaluates on demand and duplicates with the rules", async () => {
    const created = await createSegment({
      name: "Verified",
      description: "",
      conditions: VERIFIED,
    });
    await insertUser();

    expect((await evaluateSegment(created._id)).estimatedCount).toBe(1);
    const copy = await duplicateSegment(created._id);
    expect(copy._id).not.toBe(created._id);
    expect(await GetModel(SegmentModel).get(copy._id)).toMatchObject({
      name: "Verified (copy)",
      conditions: VERIFIED,
      estimatedCount: 1,
    });
  });

  it("refuses to save or evaluate a segment that does not exist", async () => {
    await expect(saveSegment("missing", { name: "x" })).rejects.toMatchObject({
      body: "saas.errors.segments.not_found",
    });
    await expect(evaluateSegment("missing")).rejects.toMatchObject({
      body: "saas.errors.segments.not_found",
    });
  });

  it("previews draft rules against the saved members without saving", async () => {
    const kept = await insertUser();
    const unverified = await insertUser({ isValidated: false });
    const created = await createSegment({
      name: "Verified",
      description: "",
      conditions: VERIFIED,
    });

    const preview = await previewSegment(
      {
        logical: "or",
        conditions: [
          { field: "isValidated", operator: "eq", value: false },
          { field: "email", operator: "eq", value: kept.email },
        ],
      },
      created._id,
    );

    expect(preview).toMatchObject({
      matchCount: 2,
      savedCount: 1,
      addedCount: 1,
      removedCount: 0,
      signals: [
        { path: "0", count: 1 },
        { path: "1", count: 1 },
      ],
    });
    expect(preview.sample[0]?._id).toBe(unverified._id);
    expect(preview.savedEvaluatedAt).toBeInstanceOf(Date);
    expect((await GetModel(SegmentModel).get(created._id))?.conditions).toEqual(
      VERIFIED,
    );
  });
});

describe("the user page", () => {
  it("explains a user's segments with the workspaces meeting the rules", async () => {
    const owner = await insertUser();
    await insertWorkspace({ name: "Initech", owner, billingState: "past_due" });
    await insertWorkspace({ name: "Hooli", owner });
    await createSegment({
      name: "Past due owners",
      description: "",
      conditions: PAST_DUE_OWNERS,
    });

    const [match] = await loadUserSegmentMatches(owner._id);

    expect(match).toMatchObject({
      name: "Past due owners",
      matchesNow: true,
      explanation: {
        conditions: [{ kind: "workspaceRef", workspaceNames: ["Initech"] }],
      },
    });
  });

  it("describes the user from what the DMS stores of them", async () => {
    const owner = await insertUser({
      password: "hash",
      twoFactorMethods: ["totp"],
      twoFactorBackupCodes: ["a", "b"],
      twoFactorBackupCodesGeneratedAt: new Date(),
    });
    const member = await insertUser();
    await insertWorkspace({ name: "Initech", owner, members: [member] });
    await GetModel(UserExternalIdentityModel).insert({
      _id: `google:${owner._id}`,
      userId: owner._id,
      provider: "google",
      providerAccountId: owner._id,
      email: owner.email,
    });

    const detail = await loadUserDetail(owner._id, member._id);

    expect(detail).toMatchObject({
      isSelf: false,
      isPlatformAdmin: false,
      workspaces: [{ name: "Initech", isTenantOwner: true }],
      security: {
        signInMethods: ["password", "google"],
        twoFactorMethods: ["totp"],
        backupCodesLeft: 2,
        isEmailVerified: true,
      },
    });
  });

  it("sums the paid invoices of owned workspaces per currency", async () => {
    const owner = await insertUser();
    const tenantId = await insertWorkspace({ name: "Initech", owner });
    const invoices = GetModel(InvoiceModel, tenantId);
    const invoice = (status: string, total: number, currency: string) => ({
      documentType: "invoice" as const,
      stripeInvoiceId: randomUUID(),
      status,
      total,
      amount: total,
      currency,
      issuedAt: new Date(),
    });
    await invoices.insert([
      invoice("paid", 4900, "eur"),
      invoice("paid", 100, "EUR"),
      invoice("open", 9999, "eur"),
      invoice("paid", 2000, "usd"),
    ] as never);

    expect(await sumPaidInvoices([tenantId])).toEqual([
      { currency: "EUR", amount: 5000 },
      { currency: "USD", amount: 2000 },
    ]);
  });
});

describe("platform role changes", () => {
  function controller(): SaasPlatformOwnersController {
    const instance = new SaasPlatformOwnersController();
    instance.userModel = GetModel(UserModel);
    return instance;
  }

  it("words the promotion with what the role grants and the seats it frees", async () => {
    const admin = await insertUser({ owner: true });
    const owner = await insertUser();
    const member = await insertUser({ name: "Margaux" });
    await insertWorkspace({ name: "Initech", owner, members: [member] });

    const dialog = await controller().promoteConfirm(admin, member._id);

    expect(dialog).toMatchObject({
      title: "$saas.users.platform_role.promote_title",
      params: { name: "Margaux" },
      color: "primary",
    });
    expect(dialog.impact?.at(-1)).toMatchObject({
      label: "$saas.users.platform_role.frees_seats",
      count: "Initech",
    });
  });

  it("explains instead of confirming a demotion of oneself or of the last admin", async () => {
    const admin = await insertUser({ owner: true });

    expect(await controller().demoteConfirm(admin, admin._id)).toMatchObject({
      title: "$saas.users.platform_role.demote_blocked_self_title",
      blocked: true,
    });
    const other = await insertUser();
    const lone = await insertUser({ owner: true });
    await GetModel(UserModel).update(admin._id, { owner: false });
    expect(await controller().demoteConfirm(other, lone._id)).toMatchObject({
      title: "$saas.users.platform_role.demote_blocked_last_title",
      blocked: true,
    });
  });

  it("refuses a self demotion on the server", async () => {
    const admin = await insertUser({ owner: true });
    await insertUser({ owner: true });

    await expect(controller().demote(admin, admin._id)).rejects.toMatchObject({
      body: "saas.errors.platform_owner.cannot_demote_self",
    });
  });

  it("syncs the billed seats of the workspaces the user supports", async () => {
    const admin = await insertUser({ owner: true });
    const owner = await insertUser();
    const member = await insertUser();
    const tenantId = await insertWorkspace({
      name: "Initech",
      owner,
      members: [member],
    });

    await controller().promote(admin, member._id);
    expect((await GetModel(UserModel).get(member._id))?.owner).toBe(true);
    await controller().demote(admin, member._id);

    expect((await GetModel(UserModel).get(member._id))?.owner).toBe(false);
    expect(seatSync).toHaveBeenCalledTimes(2);
    expect(seatSync.mock.calls.map(([id]) => id)).toEqual([tenantId, tenantId]);
    expect(notify).toHaveBeenCalledTimes(2);
  });
});
