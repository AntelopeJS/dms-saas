import { HTTPResult } from "@antelopejs/interface-api";
import type { User } from "@antelopejs/interface-dms/auth/db";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PlanMigration, PlanMigrationModel } from "../src/db";

const harness = vi.hoisted(() => ({
  subscriptions: new Map<string, unknown>(),
  stripePriceId: "price_team" as string | null,
}));

const worker = vi.hoisted(() => ({
  reconcileMigration: vi.fn(async () => undefined),
  resolveUncertainWorkspace: vi.fn(async () => undefined),
  retryFailedPlanMigrationWorkspaces: vi.fn(async () => undefined),
}));

vi.mock("../src/workers", () => worker);

vi.mock("../src/stripe/client", () => ({
  isStripeConfigured: () => true,
  stripeDashboardUrl: (path: string) => `https://stripe.test/${path}`,
  getStripeClient: () => ({
    subscriptions: {
      retrieve: async () => ({
        items: { data: [{ price: { id: harness.stripePriceId } }] },
      }),
    },
  }),
}));

const PLANS = new Map([
  [
    "starter",
    {
      _id: "starter",
      name: "Starter",
      price: 9,
      currency: "EUR",
      paymentProviderRefs: { stripePriceId: "price_starter" },
    },
  ],
  [
    "team",
    {
      _id: "team",
      name: "Team",
      price: 150,
      currency: "EUR",
      paymentProviderRefs: { stripePriceId: "price_team" },
    },
  ],
]);

const TENANTS = new Map([
  ["hooli", "Hooli"],
  ["bluth", "Bluth Company"],
  ["pied", "Pied Piper"],
]);

vi.mock("@antelopejs/interface-database-decorators", async (original) => {
  const actual =
    await original<
      typeof import("@antelopejs/interface-database-decorators")
    >();
  return {
    ...actual,
    GetModel: (model: { name: string }, tenantId?: string) => {
      const models: Record<string, unknown> = {
        PlanModel: {
          get: async (id: string) => PLANS.get(id),
          findNotDeleted: async () => [...PLANS.values()],
        },
        TenantModel: {
          get: async (id: string) =>
            TENANTS.has(id) ? { _id: id, name: TENANTS.get(id) } : undefined,
        },
        UserModel: {
          get: async (id: string) => ({ _id: id, name: `User ${id}` }),
        },
        TenantSubscriptionModel: {
          findOne: async () => harness.subscriptions.get(tenantId ?? ""),
        },
        FeatureModel: {
          getAll: async () => [
            {
              _id: "members.max",
              displayName: "Members",
              localize: () => ({ displayName: "Members" }),
            },
          ],
        },
      };
      return models[model.name];
    },
  };
});

vi.mock("../src/plans", async (original) => ({
  ...(await original<object>()),
  localizeFeature: (feature: { displayName: string }) => feature,
}));

import { SaasPlanMigrationsController } from "../src/routes/platformOwner/plan-migrations";

const OWNER = { _id: "operator" } as User;
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

function controller(row: PlanMigration): SaasPlanMigrationsController {
  const instance = new SaasPlanMigrationsController();
  instance.planMigrationModel = {
    get: vi.fn(async (id: string) => (id === row._id ? row : undefined)),
  } as unknown as PlanMigrationModel;
  return instance;
}

interface ButtonAction {
  label: string;
  to?: string;
  target?: { type: string; url: string };
  confirm?: { from: string };
}

beforeEach(() => {
  harness.subscriptions.clear();
  harness.subscriptions.set("bluth", {
    planId: "starter",
    stripeSubscriptionId: "sub_bluth",
  });
  harness.stripePriceId = "price_team";
  vi.clearAllMocks();
});

describe("the migration header", () => {
  it("offers no retry nor close while a workspace is uncertain, and names it", async () => {
    const header = await controller(migration()).header(OWNER, "mig");
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
    const header = await controller(settled).header(OWNER, "mig");
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
    const actions = (await controller(partial).header(OWNER, "mig"))
      .actions as ButtonAction[];

    expect(actions.map((action) => action.target?.url).slice(2)).toEqual([
      `${API}/retry`,
    ]);
  });

  it("refuses a migration that does not exist", async () => {
    const error = await controller(migration())
      .header(OWNER, "missing")
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(HTTPResult);
  });
});

describe("the migration blocks", () => {
  it("counts the captured, moved and not moved workspaces", async () => {
    const { items } = await controller(migration()).totals(OWNER, "mig");
    expect(items.map((item) => [item.id, item.value])).toEqual([
      ["captured", 3],
      ["moved", 1],
      ["not-moved", 2],
      ["notified", 1],
    ]);
  });

  it("lists the workspaces, the uncertain one settleable, and filters the attention tab", async () => {
    const all = await controller(migration()).workspaces(
      OWNER,
      "mig",
      undefined,
    );
    const attention = await controller(migration()).workspaces(
      OWNER,
      "mig",
      "is:attention",
    );

    expect(all.total).toBe(3);
    expect(attention.results.map((row) => row._id)).toEqual(["bluth", "pied"]);
    expect(attention.results[0]).toMatchObject({
      migrationId: "mig",
      name: "Bluth Company",
      outcome: "reconciliation_required",
      stripeSubscriptionId: "sub_bluth",
      stripeUrl: "https://stripe.test/subscriptions/sub_bluth",
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
    const { items } = await controller(migration()).changes(OWNER, "mig", "en");
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
    const { items } = await controller(reconciled).journal(OWNER, "mig");
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
    const dialog = await controller(migration()).resolveConfirmation(
      OWNER,
      "mig",
      "bluth",
      "moved",
    );
    expect(dialog).toMatchObject({
      title: "$saas.catalog.migrations.resolve.moved_title",
      params: { name: "Bluth Company", to: "Team" },
      color: "primary",
      impact: [{ count: "Team" }, { count: "Starter" }],
    });
  });

  it("warns when the operator settles against what Stripe reads", async () => {
    harness.stripePriceId = "price_starter";
    const dialog = await controller(migration()).resolveConfirmation(
      OWNER,
      "mig",
      "bluth",
      "moved",
    );
    expect(dialog.color).toBe("warning");
  });

  it("refuses to word the resolution of a workspace that is not uncertain", async () => {
    const error = await controller(migration())
      .resolveConfirmation(OWNER, "mig", "pied", "moved")
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(HTTPResult);
  });

  it("asks for the audit note when closing", async () => {
    const dialog = await controller(migration()).reconcileConfirmation(
      OWNER,
      "mig",
    );
    expect(dialog.fields?.map((field) => [field.id, field.required])).toEqual([
      ["note", true],
    ]);
  });

  it("counts what a retry moves again and skips", async () => {
    const dialog = await controller(migration()).retryConfirmation(
      OWNER,
      "mig",
    );
    expect(dialog.params).toMatchObject({ count: 1, name: "Pied Piper" });
    expect(dialog.impact?.map((entry) => entry.count)).toEqual([1, 1]);
  });

  it("reads what Stripe bills a workspace, for the Stripe check", async () => {
    const { items } = await controller(migration()).stripeReading(
      OWNER,
      "mig",
      "bluth",
    );
    expect(items.map((item) => [item.id, item.value])).toEqual([
      ["subscription", "sub_bluth"],
      ["stripe", "Team"],
      ["dms", "Starter"],
      ["verdict", "$saas.catalog.migrations.detail.verdict_target"],
    ]);
  });
});

describe("the migration detail page", () => {
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
        from: "/api/saas/plan-migrations/{migrationId}/workspaces/{_id}/dialogs/moved",
      },
      {
        from: "/api/saas/plan-migrations/{migrationId}/workspaces/{_id}/dialogs/not_moved",
      },
      undefined,
    ]);
  });
});
