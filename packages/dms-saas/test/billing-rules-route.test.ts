import type { User } from "@antelopejs/interface-dms/auth/db";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  BillingSettingsModel,
  LegalDocumentsModel,
  Plan,
  PlanModel,
} from "../src/db";

const harness = vi.hoisted(() => ({
  isStripeConfigured: vi.fn(() => true),
  reconcile: vi.fn(async () => undefined),
  startReconciliation: vi.fn(),
}));

vi.mock("../src/stripe/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/stripe/client")>()),
  isStripeConfigured: harness.isStripeConfigured,
}));

vi.mock("../src/plans/stripe-sync", () => ({
  reconcilePlansWithStripe: harness.reconcile,
  startPlanReconciliation: harness.startReconciliation,
}));

import { SaasBillingSettingsController } from "../src/routes/platformOwner/billing-settings";

const ADMIN = {} as User;
const TAX_CODE = "txcd_10000000";

type Row = Record<string, unknown>;

function memoryModel(initial?: Row) {
  const state = { row: initial };
  return {
    state,
    model: {
      get: async () => state.row,
      insert: async ([row]: Row[]) => {
        state.row = row;
      },
      update: async (_id: string, patch: Row) => {
        state.row = { ...state.row, ...patch };
      },
    },
  };
}

function syncedPlan(taxCode: string): Plan {
  return {
    _id: "pro",
    name: "Pro",
    description: "",
    price: 29,
    currency: "eur",
    interval: "month",
    billingMode: "flat",
    paymentProviderRefs: {
      stripeProductId: "prod_1",
      stripePriceId: "price_1",
      stripeSyncedTerms: {
        product: { name: "Pro", description: "", taxCode },
        price: {
          unitAmount: 2_900,
          currency: "eur",
          interval: "month",
          billingMode: "flat",
        },
      },
    },
  } as unknown as Plan;
}

let settings: ReturnType<typeof memoryModel>;
let legal: ReturnType<typeof memoryModel>;
let controller: SaasBillingSettingsController;

beforeEach(() => {
  settings = memoryModel();
  legal = memoryModel();
  controller = new SaasBillingSettingsController();
  controller.billingSettingsModel =
    settings.model as unknown as BillingSettingsModel;
  controller.legalDocumentsModel =
    legal.model as unknown as LegalDocumentsModel;
  controller.planModel = {
    findActiveNotDeleted: async () => [
      syncedPlan(TAX_CODE),
      { ...syncedPlan("txcd_99999999"), _id: "team" },
      { _id: "free", price: 0, paymentProviderRefs: {} },
    ],
  } as unknown as PlanModel;
  harness.isStripeConfigured.mockReturnValue(true);
  harness.reconcile.mockClear();
  harness.startReconciliation.mockClear();
});

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("expected a rejection");
}

describe("billing rules & legal page", () => {
  it("loads the settings, the texts and the panels beside them", async () => {
    const payload = await controller.get(ADMIN);

    expect(payload).toMatchObject({
      autoSuspendEnabled: true,
      autoSuspendDelayDays: 14,
      maxFreeWorkspacesPerCard: 1,
      stripeTaxCode: TAX_CODE,
      termsOfUse: "",
      customerTimeline: {
        autoSuspendEnabled: true,
        autoSuspendDelayDays: 14,
        dataRetentionDaysAfterCancellation: 30,
      },
      refundExample: { moneyBackGuaranteeMode: "full" },
      planTaxSync: {
        taxCode: TAX_CODE,
        synced: 1,
        total: 2,
        isStripeConfigured: true,
      },
      termsOfUseRelease: {
        version: 0,
        publishedAt: null,
        path: "/terms-of-use",
      },
    });
  });

  it("saves the settings and publishes the changed documents at once", async () => {
    const payload = await controller.update(ADMIN, {
      autoSuspendDelayDays: 21,
      moneyBackGuaranteeMode: "prorated",
      privacyPolicy: "<p>Processors</p>",
      customerTimeline: { ignored: true },
    });

    expect(settings.state.row).toMatchObject({
      autoSuspendDelayDays: 21,
      moneyBackGuaranteeMode: "prorated",
    });
    expect(settings.state.row).not.toHaveProperty("customerTimeline");
    expect(payload).toMatchObject({
      privacyPolicy: "<p>Processors</p>",
      privacyPolicyRelease: { version: 1, path: "/privacy-policy" },
      termsOfUseRelease: { version: 0, publishedAt: null },
    });
  });

  it.each([
    { autoSuspendDelayDays: 0 },
    { autoSuspendDelayDays: 2.5 },
    { dataRetentionDaysAfterCancellation: -1 },
    { maxFreeWorkspacesPerCard: -1 },
    { moneyBackGuaranteeWindowDays: 400 },
    { moneyBackGuaranteeMode: "half" },
    { stripeTaxCode: "vat" },
  ])("refuses %o", async (body) => {
    const error = await rejection(controller.update(ADMIN, body));

    expect(error).toMatchObject({ status: 400 });
    expect(settings.state.row).toBeUndefined();
  });

  it("turns the free-workspaces-per-card rule off with 0", async () => {
    const payload = await controller.update(ADMIN, {
      maxFreeWorkspacesPerCard: 0,
    });

    expect(settings.state.row?.maxFreeWorkspacesPerCard).toBe(0);
    expect(payload.maxFreeWorkspacesPerCard).toBe(0);
  });

  it("carries a new tax category to the plans in the background", async () => {
    await controller.update(ADMIN, { stripeTaxCode: "txcd_10103000" });
    expect(harness.startReconciliation).toHaveBeenCalledOnce();

    await controller.update(ADMIN, { stripeTaxCode: "txcd_10103000" });
    expect(harness.startReconciliation).toHaveBeenCalledOnce();
  });

  it("re-syncs the plans and records when", async () => {
    const status = await controller.resyncPlans(ADMIN);

    expect(harness.reconcile).toHaveBeenCalledOnce();
    expect(status.syncedAt).toBeInstanceOf(Date);
    expect(settings.state.row?.plansSyncedAt).toBe(status.syncedAt);
  });

  it("refuses to re-sync without Stripe", async () => {
    harness.isStripeConfigured.mockReturnValue(false);

    expect(await rejection(controller.resyncPlans(ADMIN))).toMatchObject({
      status: 409,
    });
    expect(harness.reconcile).not.toHaveBeenCalled();
  });
});
