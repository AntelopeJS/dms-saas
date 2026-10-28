import { fromPartial } from "@total-typescript/shoehorn";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  rememberCustomerLocale,
  syncCustomerPreferredLocale,
  toStripePreferredLocales,
} from "../src/stripe/customer-locale";
import { createTenantCheckoutCustomer } from "../src/stripe/workspace-checkout";
import { useSuiteStripe } from "./helpers/stripe";

const stripe = useSuiteStripe();

function stubCustomerUpdate() {
  return vi
    .spyOn(stripe.write.customers, "update")
    .mockResolvedValue(fromPartial({}));
}

let update: ReturnType<typeof stubCustomerUpdate>;

beforeEach(() => {
  update = stubCustomerUpdate();
});

describe("Stripe customer locale", () => {
  it.each([
    ["fr", ["fr"]],
    ["fr-FR", ["fr"]],
    ["EN", ["en"]],
    ["", undefined],
    [undefined, undefined],
  ])("writes %s as %j", (language, locales) => {
    expect(toStripePreferredLocales(language)).toEqual(locales);
  });

  it("updates the customer once the owner's language changed", async () => {
    await syncCustomerPreferredLocale("cus_change", "fr");
    await syncCustomerPreferredLocale("cus_change", "fr");
    await syncCustomerPreferredLocale("cus_change", "en");

    expect(update.mock.calls).toEqual([
      ["cus_change", { preferred_locales: ["fr"] }],
      ["cus_change", { preferred_locales: ["en"] }],
    ]);
  });

  it("leaves alone a customer just created in that language", async () => {
    rememberCustomerLocale("cus_new", "fr-FR");

    await syncCustomerPreferredLocale("cus_new", "fr");

    expect(update).not.toHaveBeenCalled();
  });

  it("does nothing without a customer or a language", async () => {
    await syncCustomerPreferredLocale(null, "fr");
    await syncCustomerPreferredLocale("cus_none", undefined);

    expect(update).not.toHaveBeenCalled();
  });

  it("never fails the request when Stripe refuses the update", async () => {
    update.mockRejectedValueOnce(new Error("rate limited"));

    await expect(
      syncCustomerPreferredLocale("cus_refused", "fr"),
    ).resolves.toBeUndefined();
    await syncCustomerPreferredLocale("cus_refused", "fr");

    expect(update).toHaveBeenCalledTimes(2);
  });
});

describe("Checkout customer", () => {
  it("is created in the owner's language", async () => {
    const create = vi
      .spyOn(stripe.write.customers, "create")
      .mockResolvedValue(fromPartial({ id: "cus_checkout" }));

    await createTenantCheckoutCustomer({
      tenantId: "acme",
      ownerEmail: "owner@example.com",
      ownerLanguage: "fr",
    });
    await syncCustomerPreferredLocale("cus_checkout", "fr");

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ preferred_locales: ["fr"] }),
      undefined,
    );
    expect(update).not.toHaveBeenCalled();
  });
});
