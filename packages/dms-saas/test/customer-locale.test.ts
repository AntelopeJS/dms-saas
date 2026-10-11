import { beforeEach, describe, expect, it, vi } from "vitest";

const stripe = vi.hoisted(() => ({ customers: { update: vi.fn() } }));

vi.mock("../src/stripe/client", () => ({ getStripeClient: () => stripe }));

const {
  rememberCustomerLocale,
  syncCustomerPreferredLocale,
  toStripePreferredLocales,
} = await import("../src/stripe/customer-locale");

beforeEach(() => {
  vi.clearAllMocks();
  stripe.customers.update.mockResolvedValue({});
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

    expect(stripe.customers.update.mock.calls).toEqual([
      ["cus_change", { preferred_locales: ["fr"] }],
      ["cus_change", { preferred_locales: ["en"] }],
    ]);
  });

  it("leaves alone a customer just created in that language", async () => {
    rememberCustomerLocale("cus_new", "fr-FR");

    await syncCustomerPreferredLocale("cus_new", "fr");

    expect(stripe.customers.update).not.toHaveBeenCalled();
  });

  it("does nothing without a customer or a language", async () => {
    await syncCustomerPreferredLocale(null, "fr");
    await syncCustomerPreferredLocale("cus_none", undefined);

    expect(stripe.customers.update).not.toHaveBeenCalled();
  });

  it("never fails the request when Stripe refuses the update", async () => {
    stripe.customers.update.mockRejectedValueOnce(new Error("rate limited"));

    await expect(
      syncCustomerPreferredLocale("cus_refused", "fr"),
    ).resolves.toBeUndefined();
    await syncCustomerPreferredLocale("cus_refused", "fr");

    expect(stripe.customers.update).toHaveBeenCalledTimes(2);
  });
});

describe("Checkout customer", () => {
  it("is created in the owner's language", async () => {
    const create = vi.fn(async () => ({ id: "cus_checkout" }));
    Object.assign(stripe.customers, { create });
    const { createTenantCheckoutCustomer } =
      await import("../src/stripe/workspace-checkout");

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
    expect(stripe.customers.update).not.toHaveBeenCalled();
  });
});
