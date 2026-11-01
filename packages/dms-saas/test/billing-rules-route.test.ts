import { setTimeout as sleep } from "node:timers/promises";
import { GetModel } from "@antelopejs/interface-database-decorators";
import type { User } from "@antelopejs/interface-dms/auth/db";
import { fromPartial } from "@total-typescript/shoehorn";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  BILLING_SETTINGS_SINGLETON_ID,
  BillingSettingsModel,
  LEGAL_DOCUMENTS_SINGLETON_ID,
  LegalDocumentsModel,
  type Plan,
  PlanModel,
} from "../src/db";
import { SaasBillingSettingsController } from "../src/routes/platformOwner/billing-settings";
import { useMongoDatabase } from "./helpers/mongo";
import { planRow } from "./helpers/plan-row";
import { insertPlan } from "./helpers/localized-plans";
import { withUnconfiguredStripe } from "./helpers/unconfigured-stripe";
import { useSuiteStripe } from "./helpers/stripe";
import { httpRefusal } from "./helpers/refusal";
import {
  type FormFieldSerialized,
  isFieldGroupSerialized,
} from "@antelopejs/interface-dms/base";

useMongoDatabase("billing-rules-route");
const stripe = useSuiteStripe();

const ADMIN = fromPartial<User>({});
const TAX_CODE = "txcd_10000000";
/** How long a reconciliation that must not start is given to show itself. */
const NO_RECONCILIATION_WAIT_MS = 100;

function syncedPlan(taxCode: string, id = "pro"): Plan {
  return planRow(
    fromPartial<Partial<Plan>>({
      _id: id,
      name: "Pro",
      description: "",
      price: 29,
      currency: "eur",
      interval: "month",
      billingMode: "flat",
      isActive: true,
      isDeleted: false,
      paymentProviderRefs: {
        stripeProductId: `prod_${id}`,
        stripePriceId: `price_${id}`,
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
    }),
  );
}

let controller: SaasBillingSettingsController;
let updateProduct: ReturnType<typeof stubProductUpdate>;

function stubProductUpdate() {
  return vi
    .spyOn(stripe.write.products, "update")
    .mockResolvedValue(fromPartial({}));
}

function settingsRow() {
  return GetModel(BillingSettingsModel).get(BILLING_SETTINGS_SINGLETON_ID);
}

/**
 * Starts every test from a platform without billing settings or legal texts,
 * whose catalogue holds a plan synced under the default tax category, one
 * synced under another, and a free plan.
 */
beforeEach(async () => {
  updateProduct = stubProductUpdate();
  await GetModel(BillingSettingsModel).delete(BILLING_SETTINGS_SINGLETON_ID);
  await GetModel(LegalDocumentsModel).delete(LEGAL_DOCUMENTS_SINGLETON_ID);
  for (const { _id } of await GetModel(PlanModel).getAll()) {
    await GetModel(PlanModel).delete(_id);
  }
  await insertPlan(syncedPlan(TAX_CODE));
  await insertPlan(syncedPlan("txcd_99999999", "team"));
  await insertPlan(
    planRow({
      _id: "free",
      name: "Free",
      description: "",
      price: 0,
      isActive: true,
      isDeleted: false,
      paymentProviderRefs: {},
    }),
  );
  controller = new SaasBillingSettingsController();
  controller.billingSettingsModel = GetModel(BillingSettingsModel);
  controller.legalDocumentsModel = GetModel(LegalDocumentsModel);
  controller.planModel = GetModel(PlanModel);
});

describe("billing rules & legal page", () => {
  it("loads the settings, the texts and the panels beside them", async () => {
    const payload = await controller.get(ADMIN);

    expect(payload).toMatchObject({
      autoSuspendEnabled: true,
      autoSuspendDelayDays: 14,
      maxFreeWorkspacesPerCard: 0,
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

    expect(await settingsRow()).toMatchObject({
      autoSuspendDelayDays: 21,
      moneyBackGuaranteeMode: "prorated",
    });
    expect(await settingsRow()).not.toHaveProperty("customerTimeline");
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
    const error = await httpRefusal(controller.update(ADMIN, body));

    expect(error).toMatchObject({ status: 400 });
    expect(await settingsRow()).toBeUndefined();
  });

  it("turns the free-workspaces-per-card rule off with 0", async () => {
    const payload = await controller.update(ADMIN, {
      maxFreeWorkspacesPerCard: 0,
    });

    expect((await settingsRow())?.maxFreeWorkspacesPerCard).toBe(0);
    expect(payload.maxFreeWorkspacesPerCard).toBe(0);
  });

  it("carries a new tax category to the plans in the background", async () => {
    await controller.update(ADMIN, { stripeTaxCode: "txcd_10103000" });
    await vi.waitFor(() => expect(updateProduct).toHaveBeenCalledTimes(2));
    expect(
      updateProduct.mock.calls.map(([id, params]) => [id, params?.tax_code]),
    ).toEqual(
      expect.arrayContaining([
        ["prod_pro", "txcd_10103000"],
        ["prod_team", "txcd_10103000"],
      ]),
    );

    await controller.update(ADMIN, { stripeTaxCode: "txcd_10103000" });
    await sleep(NO_RECONCILIATION_WAIT_MS);
    expect(updateProduct).toHaveBeenCalledTimes(2);
  });

  it("re-syncs the plans and records when", async () => {
    const status = await controller.resyncPlans(ADMIN);

    expect(updateProduct).toHaveBeenCalledOnce();
    expect(updateProduct).toHaveBeenCalledWith(
      "prod_team",
      expect.objectContaining({ tax_code: TAX_CODE }),
    );
    expect(status.syncedAt).toBeInstanceOf(Date);
    expect((await settingsRow())?.plansSyncedAt).toEqual(status.syncedAt);
  });

  it("refuses to re-sync without Stripe", async () => {
    await withUnconfiguredStripe(stripe, async (unconfigured) => {
      const update = vi
        .spyOn(unconfigured.write.products, "update")
        .mockResolvedValue(fromPartial({}));

      expect(await httpRefusal(controller.resyncPlans(ADMIN))).toMatchObject({
        status: 409,
      });
      expect(update).not.toHaveBeenCalled();
    });
  });
});

describe("billing rules page module defaults", () => {
  it("offers, on each rule, the value a fresh platform's route answers", async () => {
    const { SaasSettingsController } =
      await import("../src/pages/platform/settings");
    const { options } = await SaasSettingsController.form.serialize();
    const offered = Object.fromEntries(
      (options?.fields ?? [])
        .filter(
          (field): field is FormFieldSerialized =>
            !isFieldGroupSerialized(field) && !!field.offersDefault,
        )
        .map((field) => [field.id, field.defaultValue]),
    );
    const fresh = await controller.get(ADMIN);

    expect(Object.keys(offered).sort()).toEqual([
      "autoProrataOnCancelEnabled",
      "autoSuspendDelayDays",
      "autoSuspendEnabled",
      "maxFreeWorkspacesPerCard",
      "moneyBackGuaranteeEnabled",
      "moneyBackGuaranteeMode",
      "moneyBackGuaranteeWindowDays",
      "stripeTaxCode",
    ]);
    for (const [id, value] of Object.entries(offered)) {
      expect(fresh[id], id).toEqual(value);
    }
    expect(offered).not.toHaveProperty("dataRetentionDaysAfterCancellation");
  });
});
