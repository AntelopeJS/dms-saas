import { beforeAll, describe, expect, it, vi } from "vitest";
import { fetchDefaultPaymentMethod } from "../src/billing-state/recovery";
import {
  fetchPrimaryTaxId,
  fetchScheduledCancellation,
  getStripeReadClient,
  initStripeClient,
  isStripeConfigured,
} from "../src/stripe";
import { captureLogs } from "./helpers/logging";

const logs = captureLogs();

/** The demo's keys: well-formed, but standing for no Stripe account. */
const PLACEHOLDER_KEYS = {
  secretKey: "sk_test_placeholder",
  webhookSecret: "whsec_placeholder",
  publishableKey: "pk_test_placeholder",
};

describe("Stripe reads without usable keys", () => {
  beforeAll(() => {
    initStripeClient(PLACEHOLDER_KEYS);
  });

  it("treats placeholder keys as Stripe not configured", () => {
    expect(isStripeConfigured()).toBe(false);
  });

  it("reads nothing from Stripe and logs nothing for the billing page", async () => {
    const stripe = getStripeReadClient();
    const calls = [
      vi.spyOn(stripe.customers, "retrieve"),
      vi.spyOn(stripe.customers, "listTaxIds"),
      vi.spyOn(stripe.subscriptions, "retrieve"),
    ];

    await expect(fetchDefaultPaymentMethod("cus_demo")).resolves.toBeNull();
    await expect(
      fetchScheduledCancellation("sub_demo_solmos"),
    ).resolves.toBeNull();
    await expect(fetchPrimaryTaxId("cus_demo")).resolves.toEqual({
      reachable: false,
      taxId: null,
    });

    for (const call of calls) expect(call).not.toHaveBeenCalled();
    expect(logs.at("WARN")).toEqual([]);
    expect(logs.at("ERROR")).toEqual([]);
  });
});
