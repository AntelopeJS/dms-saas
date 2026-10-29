import { HTTPResult } from "@antelopejs/interface-api";
import { GetModel } from "@antelopejs/interface-database-decorators";
import type { User } from "@antelopejs/interface-dms/auth/db";
import { TenantModel } from "@antelopejs/interface-dms/db";
import { fromPartial } from "@total-typescript/shoehorn";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  FeatureModel,
  type PlanMigration,
  PlanMigrationModel,
  TenantSubscriptionModel,
} from "../src/db";
import { SaasPlanMigrationsController } from "../src/routes/platformOwner/plan-migrations";
import { stripeDashboardUrl } from "../src/stripe/client";
import { createUser } from "./helpers/dms";
import { insertPlan } from "./helpers/localized-plans";
import { useMongoDatabase } from "./helpers/mongo";
import { planRow } from "./helpers/plan-row";
import { useSuiteStripe } from "./helpers/stripe";

useMongoDatabase("plan-migration-detail-routes");
const stripe = useSuiteStripe();

const PLANS = [
  planRow({
    _id: "starter",
    name: "Starter",
    price: 9,
    currency: "EUR",
    isActive: true,
    isDeleted: false,
    paymentProviderRefs: { stripePriceId: "price_starter" },
  }),
  planRow({
    _id: "team",
    name: "Team",
    price: 150,
    currency: "EUR",
    isActive: true,
    isDeleted: false,
    paymentProviderRefs: { stripePriceId: "price_team" },
  }),
];

const TENANTS = [
  { _id: "hooli", name: "Hooli" },
  { _id: "bluth", name: "Bluth Company" },
  { _id: "pied", name: "Pied Piper" },
];

/** The price Stripe bills the uncertain workspace at, as the test sets it. */
let billedPriceId = "price_team";

beforeAll(async () => {
  for (const plan of PLANS) await insertPlan(plan);
  const now = new Date();
  await GetModel(TenantModel).insert(
    TENANTS.map((tenant) => ({ ...tenant, createdAt: now, updatedAt: now })),
  );
  await GetModel(TenantSubscriptionModel, "bluth").insert({
    _id: "bluth",
    planId: "starter",
    stripeSubscriptionId: "sub_bluth",
  });
  await GetModel(FeatureModel).insert({
    _id: "members.max",
    valueType: "number",
    order: 1,
  });
  for (const _id of ["camille", "hugo"])
    await createUser({ _id, name: `User ${_id}` });
});

const OWNER = fromPartial<User>({ _id: "operator" });
const API = "/api/saas/plan-migrations/mig";
const STARTED = new Date("2026-09-22T14:30:00Z");
const FINISHED = new Date("2026-09-22T14:40:00Z");

function migration(overrides: Partial<PlanMigration> = {}): PlanMigration {
  return {
    _id: "mig",
    fromPlanId: "starter",
    toPlanId: "team",
    fromPlanName: "Starter",
    toPlanName: "Team",
    status: "reconciliation_required",
    reason: "plan_retired",
    notifyMembers: true,
    initiatedBy: "camille",
    createdAt: STARTED,
    completedAt: FINISHED,
    totalWorkspaces: 3,
    snapshot: { tenantIds: ["hooli", "bluth", "pied"], target: {} },
    tenantOutcomes: [
      {
        tenantId: "hooli",
        status: "succeeded",
        error: null,
        seatQuantity: 1,
        attempt: 1,
        updatedAt: FINISHED,
      },
      {
        tenantId: "bluth",
        status: "reconciliation_required",
        error: "Stripe timed out",
        seatQuantity: 1,
        attempt: 1,
        updatedAt: FINISHED,
      },
      {
        tenantId: "pied",
        status: "failed",
        error: "Your card was declined.",
        seatQuantity: 1,
        attempt: 2,
        updatedAt: FINISHED,
      },
    ],
    permissionDiff: { added: ["a", "b"], removed: [], unchanged: [] },
    featureDiff: {
      added: [],
      removed: [],
      changed: [{ key: "members.max", oldValue: 3, newValue: -1 }],
    },
    ...overrides,
  } as unknown as PlanMigration;
}

/**
 * A controller whose migration table holds `row` alone, as the worker left
 * it: inserted as a new job, then brought to the state `row` holds.
 */
async function controller(
  row: PlanMigration,
): Promise<SaasPlanMigrationsController> {
  const migrations = GetModel(PlanMigrationModel);
  await migrations.table.delete().run();
  const { _id, ...progress } = row;
  await migrations.insert({ _id });
  await migrations.update(_id, progress);
  await migrations.table.get(_id).update({ createdAt: row.createdAt }).run();
  const instance = new SaasPlanMigrationsController();
  instance.planMigrationModel = migrations;
  return instance;
}

interface ButtonAction {
  label: string;
  to?: string;
  target?: { type: string; url: string };
  confirm?: { from: string };
}

beforeEach(() => {
  billedPriceId = "price_team";
  vi.spyOn(stripe.write.subscriptions, "retrieve").mockImplementation(
    async () =>
      fromPartial({ items: { data: [{ price: { id: billedPriceId } }] } }),
  );
});

describe("the migration header", () => {
  it("offers no retry nor close while a workspace is uncertain, and names it", async () => {
    const header = await (await controller(migration())).header(OWNER, "mig");
    const actions = header.actions as ButtonAction[];

    expect(header.tone).toBe("error");
    expect(header.title).toEqual({
      key: "saas.catalog.migrations.detail.title",
      params: { from: "Starter", to: "Team" },
    });
    expect(JSON.stringify(header.description)).toContain("Bluth Company");
    expect(actions.map((action) => action.label)).toEqual([
      "$saas.catalog.migrations.detail.back",
      "$saas.catalog.migrations.detail.export",
    ]);
    expect(actions[1]?.target).toMatchObject({
      type: "exportJob",
      url: `${API}/workspaces-export/start`,
    });
  });

  it("offers the retry and the close, each asking through its dialog route, once nothing is uncertain", async () => {
    const settled = migration({
      tenantOutcomes: migration().tenantOutcomes.filter(
        (row) => row.status !== "reconciliation_required",
      ),
      snapshot: { tenantIds: ["hooli", "pied"], target: {} },
      status: "failed",
    } as Partial<PlanMigration>);
    const header = await (await controller(settled)).header(OWNER, "mig");
    const actions = header.actions as ButtonAction[];

    expect(actions.slice(2)).toMatchObject([
      {
        target: { type: "api", url: `${API}/reconcile` },
        confirm: { from: `${API}/dialogs/reconcile` },
      },
      {
        target: { type: "api", url: `${API}/retry` },
        confirm: { from: `${API}/dialogs/retry` },
      },
    ]);
  });

  it("only retries a partially failed migration, which stays closed", async () => {
    const partial = migration({
      status: "partially_failed",
      tenantOutcomes: migration().tenantOutcomes.filter(
        (row) => row.status !== "reconciliation_required",
      ),
      snapshot: { tenantIds: ["hooli", "pied"], target: {} },
    } as Partial<PlanMigration>);
    const actions = (await (await controller(partial)).header(OWNER, "mig"))
      .actions as ButtonAction[];

    expect(actions.map((action) => action.target?.url).slice(2)).toEqual([
      `${API}/retry`,
    ]);
  });

  it("refuses a migration that does not exist", async () => {
    const migrations = await controller(migration());
    await expect(migrations.header(OWNER, "missing")).rejects.toBeInstanceOf(
      HTTPResult,
    );
  });
});

describe("the migration blocks", () => {
  it("counts the captured, moved and not moved workspaces", async () => {
    const { items } = await (
      await controller(migration())
    ).totals(OWNER, "mig");
    expect(items.map((item) => [item.id, item.value])).toEqual([
      ["captured", 3],
      ["moved", 1],
      ["not-moved", 2],
      ["notified", 1],
    ]);
  });

  it("lists the workspaces, the uncertain one settleable, and filters the attention tab", async () => {
    const all = await (
      await controller(migration())
    ).workspaces(OWNER, "mig", undefined);
    const attention = await (
      await controller(migration())
    ).workspaces(OWNER, "mig", "is:attention");

    expect(all.total).toBe(3);
    expect(attention.results.map((row) => row._id)).toEqual(["bluth", "pied"]);
    expect(attention.results[0]).toMatchObject({
      migrationId: "mig",
      name: "Bluth Company",
      outcome: "reconciliation_required",
      stripeSubscriptionId: "sub_bluth",
      stripeUrl: stripeDashboardUrl("subscriptions/sub_bluth"),
      canResolve: true,
    });
    expect(attention.results[1]).toMatchObject({
      outcome: "failed",
      canResolve: false,
      attempt: 2,
      reason: "Your card was declined.",
    });
  });

  it("says what changes: price, features and permissions", async () => {
    const { items } = await (
      await controller(migration())
    ).changes(OWNER, "mig", "en");
    expect(items.map((item) => item.id)).toEqual([
      "price",
      "feature-members.max",
      "permissions-added",
    ]);
    expect(items[0]?.value).toMatchObject({
      params: {
        from: { type: "money", value: 900 },
        to: { type: "money", value: 15000 },
      },
    });
    expect(JSON.stringify(items[1]?.value)).toContain("change.unlimited");
  });

  it("journals the start, the end and the close, newest first", async () => {
    const reconciled = migration({
      reconciledAt: new Date("2026-09-23T09:00:00Z"),
      reconciledBy: "hugo",
      reconciliationNote: "Customer asked to stay",
    } as Partial<PlanMigration>);
    const { items } = await (
      await controller(reconciled)
    ).journal(OWNER, "mig");
    expect(items.map((item) => item.id)).toEqual([
      "reconciled",
      "finished",
      "started",
    ]);
    expect(items[0]?.meta).toEqual(["Customer asked to stay"]);
  });
});

describe("the migration dialogs", () => {
  it("words the resolution with what Stripe and the DMS say now", async () => {
    const dialog = await (
      await controller(migration())
    ).resolveConfirmation(OWNER, "mig", "bluth", "moved");
    expect(dialog).toMatchObject({
      title: "$saas.catalog.migrations.resolve.moved_title",
      params: { name: "Bluth Company", to: "Team" },
      color: "primary",
      impact: [{ count: "Team" }, { count: "Starter" }],
    });
  });

  it("warns when the operator settles against what Stripe reads", async () => {
    billedPriceId = "price_starter";
    const dialog = await (
      await controller(migration())
    ).resolveConfirmation(OWNER, "mig", "bluth", "moved");
    expect(dialog.color).toBe("warning");
  });

  it("refuses to word the resolution of a workspace that is not uncertain", async () => {
    const error = await (
      await controller(migration())
    )
      .resolveConfirmation(OWNER, "mig", "pied", "moved")
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(HTTPResult);
  });

  it("asks for the audit note when closing", async () => {
    const dialog = await (
      await controller(migration())
    ).reconcileConfirmation(OWNER, "mig");
    expect(dialog.fields?.map((field) => [field.id, field.required])).toEqual([
      ["note", true],
    ]);
  });

  it("counts what a retry moves again and skips", async () => {
    const dialog = await (
      await controller(migration())
    ).retryConfirmation(OWNER, "mig");
    expect(dialog.params).toMatchObject({ count: 1, name: "Pied Piper" });
    expect(dialog.impact?.map((entry) => entry.count)).toEqual([1, 1]);
  });

  it("reads what Stripe bills a workspace, for the Stripe check", async () => {
    const { items, resolution } = await (
      await controller(migration())
    ).stripeReading(OWNER, "mig", "bluth");
    expect(resolution).toBe("moved");
    expect(items.map((item) => [item.id, item.value])).toEqual([
      ["subscription", "sub_bluth"],
      ["stripe", "Team"],
      ["dms", "Starter"],
      ["verdict", "$saas.catalog.migrations.detail.verdict_target"],
    ]);
  });
});

describe("the migration detail page", () => {
  it("opens on a live bar with no period", async () => {
    const { SaasPlanMigrationDetailController: Page } =
      await import("../src/pages/platform/plans/migrations");
    const toolbar = await Page.toolbar.serialize();

    expect(toolbar.componentName).toBe("dms-page-toolbar-block");
    expect(toolbar.children.map((child) => child.id)).toEqual(["live"]);
    expect(toolbar.children[0]?.component.componentName).toBe(
      "dms-live-toggle-block",
    );
  });

  it("is made of stock blocks reading the routes, refreshed by the migration topic", async () => {
    const { SaasPlanMigrationDetailController: Page } =
      await import("../src/pages/platform/plans/migrations");
    const header = await Page.header.serialize();
    const totals = await Page.totals.serialize();
    const table = await Page.workspaces.serialize();

    expect(header.componentName).toBe("dms-banner-block");
    expect(header.options).toMatchObject({
      fetchUrl: "/api/saas/plan-migrations/{{params.id}}/header",
      realtimeTopic: "saas:plan-migrations",
    });
    expect(totals.componentName).toBe("dms-stat-group-block");
    const custom = (
      table.options as {
        rowActions?: { custom?: { label: string; confirm?: unknown }[] };
      }
    ).rowActions?.custom;
    expect(custom?.map((action) => action.confirm)).toEqual([
      undefined,
      {
        from: "/api/saas/plan-migrations/{{row.migrationId}}/workspaces/{{row._id}}/dialogs/moved",
      },
      {
        from: "/api/saas/plan-migrations/{{row.migrationId}}/workspaces/{{row._id}}/dialogs/not_moved",
      },
      undefined,
    ]);
  });
});

describe("the settlement a Stripe reading points to", () => {
  it.each([
    ["target", "moved"],
    ["source", "not_moved"],
    ["none", "not_moved"],
    ["other", null],
    ["unavailable", null],
  ] as const)("reads %s as %s", async (stripePlan, expected) => {
    const { recommendedResolution } =
      await import("../src/plans/migration-workspaces");
    expect(
      recommendedResolution({
        stripeSubscriptionId: null,
        stripeUrl: null,
        stripePlan,
        stripePlanName: null,
        dmsPlanName: null,
      }),
    ).toBe(expected);
  });
});
