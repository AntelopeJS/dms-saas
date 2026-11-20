import { randomUUID } from "node:crypto";
import { GetModel } from "@antelopejs/interface-database-decorators";
import { UserModel } from "@antelopejs/interface-dms/auth/db";
import { UserInviteModel } from "@antelopejs/interface-dms/db";
import { beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import type { JsonObject } from "@antelopejs/interface-dms-automation";
import { registerAutomationNodes } from "../src/automation";
import { recomputeTenantBillingState } from "../src/billing-state";
import {
  FeatureModel,
  SegmentModel,
  TenantBillingStateModel,
  type TenantSubscription,
  TenantSubscriptionModel,
  UserSegmentModel,
} from "../src/db";
import {
  executionCtx,
  implementAutomationCatalog,
  registeredAction,
} from "./helpers/automation";
import { addTenantMember, createUser } from "./helpers/dms";
import { useMongoDatabase } from "./helpers/mongo";
import { insertPlan } from "./helpers/plans";
import { insertTenant, seatMembers } from "./helpers/workspaces";

useMongoDatabase();
const automation = implementAutomationCatalog();
await registerAutomationNodes();

const SEAT_PLAN = "reads-seat-plan";
const UNLIMITED_PLAN = "reads-unlimited-plan";
const PARENT_PLAN = "reads-parent-plan";
const DAY_MS = 86_400_000;

beforeAll(async () => {
  await GetModel(FeatureModel).insert({
    _id: "api_calls",
    displayName: "API calls",
    description: "",
    valueType: "number",
    defaultValue: 0,
    tooltip: null,
    unit: null,
    isDetailRow: false,
    order: 1,
  });
  await insertPlan({
    _id: PARENT_PLAN,
    price: 10,
    features: [{ featureId: "api_calls", value: 1000 }],
  });
  await insertPlan({
    _id: SEAT_PLAN,
    price: 20,
    maxMembers: 5,
    inheritsFromPlanId: PARENT_PLAN,
  });
  await insertPlan({ _id: UNLIMITED_PLAN, price: 40, maxMembers: -1 });
});

function run(id: string, input: JsonObject) {
  return registeredAction(automation, id).execute(input, executionCtx());
}

async function workspace(
  fields: Partial<TenantSubscription> = {},
): Promise<string> {
  const tenantId = randomUUID();
  await insertTenant(tenantId);
  await GetModel(TenantSubscriptionModel, tenantId).insert({
    _id: tenantId,
    planId: SEAT_PLAN,
    status: "active",
    stripeSubscriptionId: null,
    ...fields,
  });
  await recomputeTenantBillingState(tenantId);
  return tenantId;
}

async function inviteOwner(tenantId: string, expiresAt: Date): Promise<void> {
  await GetModel(UserInviteModel, tenantId).insert({
    _id: randomUUID(),
    createdAt: new Date(),
    email: `invitee-${tenantId}@example.test`,
    firstname: null,
    lastname: null,
    roles_ids: [],
    language: "fr",
    token: randomUUID(),
    asTenantOwner: true,
    expiresAt,
    extensions: null,
  });
}

describe("read actions", () => {
  it("declare no side effect", () => {
    const reads = [
      "saas.get-workspace",
      "saas.get-workspace-owner",
      "saas.get-plan-constraints",
      "saas.get-upcoming-invoice",
      "saas.list-workspaces",
      "saas.list-segment-users",
    ].map((id) => registeredAction(automation, id).sideEffects);

    expect(reads).toEqual(reads.map(() => false));
  });
});

describe("saas.get-workspace", () => {
  it("reads the workspace asked for and no other", async () => {
    const asked = await workspace();
    await workspace({ planId: UNLIMITED_PLAN });

    await expect(
      run("saas.get-workspace", { tenantId: asked }),
    ).resolves.toMatchObject({
      found: true,
      tenantId: asked,
      name: asked,
      billingState: "free",
      planId: SEAT_PLAN,
    });
  });

  it("answers found false for an unknown and a deleted workspace", async () => {
    const deleted = await workspace();
    await GetModel(TenantBillingStateModel).deleteForTenant(deleted);

    for (const tenantId of [deleted, "no-such-workspace"])
      await expect(
        run("saas.get-workspace", { tenantId }),
      ).resolves.toMatchObject({
        found: false,
        planId: null,
      });
  });

  it("refuses an empty workspace id", async () => {
    await expect(run("saas.get-workspace", { tenantId: " " })).rejects.toThrow(
      "saas.get-workspace: tenantId",
    );
  });
});

describe("saas.get-workspace-owner", () => {
  it("reads the joined owner with their language, never another workspace's", async () => {
    const tenantId = await workspace();
    const owner = await createUser({ name: "Ada Owner", language: "fr" });
    await addTenantMember(tenantId, owner, true);
    const other = await workspace();
    await addTenantMember(other, await createUser(), true);

    await expect(
      run("saas.get-workspace-owner", { tenantId }),
    ).resolves.toEqual({
      found: true,
      status: "joined",
      userId: owner._id,
      name: "Ada Owner",
      email: owner.email,
      language: "fr",
    });
  });

  it("reads the invitee of a workspace created for a new account", async () => {
    const tenantId = await workspace();
    await inviteOwner(tenantId, new Date(Date.now() + DAY_MS));

    await expect(
      run("saas.get-workspace-owner", { tenantId }),
    ).resolves.toEqual({
      found: true,
      status: "invited",
      userId: null,
      name: null,
      email: `invitee-${tenantId}@example.test`,
      language: null,
    });
  });

  it("reads an expired invitation and a workspace with no owner", async () => {
    const expired = await workspace();
    await inviteOwner(expired, new Date(Date.now() - DAY_MS));
    const ownerless = await workspace();

    await expect(
      run("saas.get-workspace-owner", { tenantId: expired }),
    ).resolves.toMatchObject({ found: true, status: "expired" });
    await expect(
      run("saas.get-workspace-owner", { tenantId: ownerless }),
    ).resolves.toMatchObject({ found: false, status: "none", email: null });
  });

  it("refuses an unknown workspace", async () => {
    await expect(
      run("saas.get-workspace-owner", { tenantId: "no-such-workspace" }),
    ).rejects.toThrow('unknown workspace "no-such-workspace"');
  });
});

describe("saas.get-plan-constraints", () => {
  it("counts members and invitations against the seat cap, with inherited features", async () => {
    const tenantId = await workspace();
    await seatMembers(tenantId, 3);
    await inviteOwner(tenantId, new Date(Date.now() + DAY_MS));

    await expect(
      run("saas.get-plan-constraints", { tenantId }),
    ).resolves.toMatchObject({
      found: true,
      planId: SEAT_PLAN,
      maxMembers: 5,
      occupiedSeats: 4,
      seatsAvailable: 1,
      features: { api_calls: 1000 },
      blocked: false,
    });
  });

  it("answers no seats available figure on an unlimited plan", async () => {
    const tenantId = await workspace({ planId: UNLIMITED_PLAN });

    await expect(
      run("saas.get-plan-constraints", { tenantId }),
    ).resolves.toMatchObject({
      maxMembers: -1,
      seatsAvailable: null,
      features: { api_calls: 0 },
    });
  });

  it("reads a scheduled change and a suspended workspace", async () => {
    const effectiveAt = new Date("2026-12-01T00:00:00.000Z");
    const tenantId = await workspace({
      planId: UNLIMITED_PLAN,
      status: "suspended",
      pendingPlanId: SEAT_PLAN,
      pendingPlanChangeAt: effectiveAt,
    });

    await expect(
      run("saas.get-plan-constraints", { tenantId }),
    ).resolves.toMatchObject({
      pendingPlanId: SEAT_PLAN,
      effectiveAt: effectiveAt.toISOString(),
      blocked: true,
    });
  });

  it("answers found false for a workspace without a subscription", async () => {
    const tenantId = randomUUID();
    await insertTenant(tenantId);

    await expect(
      run("saas.get-plan-constraints", { tenantId }),
    ).resolves.toMatchObject({ found: false, planId: null });
  });
});

describe("saas.get-upcoming-invoice", () => {
  it("answers absent for a complimentary workspace", async () => {
    const tenantId = await workspace({ isComplimentary: true });

    await expect(
      run("saas.get-upcoming-invoice", { tenantId }),
    ).resolves.toMatchObject({
      status: "absent",
      reason: "complimentary",
      amountDueMinor: null,
      lineCount: 0,
    });
  });
});

const workspacePage = z.object({
  tenantIds: z.array(z.string()),
  count: z.number(),
  nextCursor: z.string().nullable(),
});

describe("saas.list-workspaces", () => {
  it("pages through every workspace of a plan without gap or repeat", async () => {
    const planId = `paged-${randomUUID()}`;
    await insertPlan({ _id: planId, price: 5 });
    const created = new Set<string>();
    for (let index = 0; index < 120; index += 1)
      created.add(await workspace({ planId }));

    const pages: string[][] = [];
    let cursor: string | undefined;
    do {
      const page = workspacePage.parse(
        await run("saas.list-workspaces", { planId, limit: 50, cursor }),
      );
      pages.push(page.tenantIds);
      cursor = page.nextCursor ?? undefined;
    } while (cursor);

    expect(pages.map((page) => page.length)).toEqual([50, 50, 20]);
    expect(new Set(pages.flat())).toEqual(created);
  });

  it("filters by state, complimentary access and renewal", async () => {
    const planId = `filtered-${randomUUID()}`;
    await insertPlan({ _id: planId, price: 5 });
    const pastDue = await workspace({
      planId,
      status: "past_due",
      stripeSubscriptionId: "sub_past_due",
    });
    const complimentary = await workspace({ planId, isComplimentary: true });
    const deleted = await workspace({ planId, isComplimentary: true });
    await GetModel(TenantBillingStateModel).deleteForTenant(deleted);

    const byState = workspacePage.parse(
      await run("saas.list-workspaces", { planId, billingState: "past_due" }),
    );
    const byAccess = workspacePage.parse(
      await run("saas.list-workspaces", { planId, isComplimentary: true }),
    );

    expect(byState.tenantIds).toEqual([pastDue]);
    expect(byAccess.tenantIds).toEqual([complimentary]);
  });

  it.each([0, 201])("refuses a page of %i", async (limit) => {
    await expect(run("saas.list-workspaces", { limit })).rejects.toThrow(
      "saas.list-workspaces: limit",
    );
  });
});

const segmentPage = z.object({
  found: z.boolean(),
  total: z.number(),
  users: z.array(
    z.object({
      userId: z.string(),
      email: z.string(),
      language: z.string().nullable(),
    }),
  ),
  userIds: z.array(z.string()),
  nextCursor: z.string().nullable(),
});

async function segmentOf(userIds: string[]): Promise<string> {
  const segmentId = randomUUID();
  await GetModel(SegmentModel).insert({
    _id: segmentId,
    name: "Engaged",
    description: "",
    conditions: { logical: "and", conditions: [] },
    estimatedCount: 0,
    revision: randomUUID(),
    lastEvaluatedAt: null,
    countHistory: [],
    lastEvaluationMs: null,
  });
  const segment = await GetModel(SegmentModel).get(segmentId);
  if (!segment) throw new Error("Segment fixture was not stored");
  await GetModel(UserSegmentModel).replaceForSegment(
    segment,
    userIds,
    new Date(),
  );
  return segmentId;
}

describe("saas.list-segment-users", () => {
  it("pages through the published membership with each user's contact data", async () => {
    const users = await Promise.all(
      Array.from({ length: 12 }, () => createUser({ language: "de" })),
    );
    const segmentId = await segmentOf(users.map((user) => user._id));

    const pages = [];
    let cursor: string | undefined;
    do {
      const page = segmentPage.parse(
        await run("saas.list-segment-users", { segmentId, limit: 5, cursor }),
      );
      pages.push(page);
      cursor = page.nextCursor ?? undefined;
    } while (cursor);

    expect(pages.map((page) => page.userIds.length)).toEqual([5, 5, 2]);
    expect(new Set(pages.flatMap((page) => page.userIds))).toEqual(
      new Set(users.map((user) => user._id)),
    );
    expect(pages[0]?.users[0]).toMatchObject({
      language: "de",
    });
    expect(pages[0]?.total).toBe(12);
  });

  it("skips a deleted user but still counts the membership", async () => {
    const kept = await createUser();
    const gone = await createUser();
    const segmentId = await segmentOf([kept._id, gone._id]);
    await GetModel(UserModel).delete(gone._id);

    const page = segmentPage.parse(
      await run("saas.list-segment-users", { segmentId }),
    );

    expect(page.userIds).toEqual([kept._id]);
    expect(page.total).toBe(2);
  });

  it("answers found false for an unknown segment", async () => {
    await expect(
      run("saas.list-segment-users", { segmentId: "no-such-segment" }),
    ).resolves.toMatchObject({ found: false, users: [] });
  });
});
