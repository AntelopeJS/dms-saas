import { beforeEach, describe, expect, it, vi } from "vitest";

const stripe = vi.hoisted(() => ({
  retrieveCustomer: vi.fn(),
}));

vi.mock("../src/stripe/client", () => ({
  getStripeClient: () => ({
    customers: {
      retrieve: (...args: unknown[]) => stripe.retrieveCustomer(...args),
    },
  }),
}));

import { retrieveStripeCustomerBalance } from "../src/stripe/customer-balance";

beforeEach(() => {
  stripe.retrieveCustomer.mockReset();
});

describe("Stripe customer balance adapter", () => {
  it.each([1_000, 0, -1_000])(
    "preserves Stripe's signed minor-unit balance %i",
    async (balance) => {
      stripe.retrieveCustomer.mockResolvedValue({
        id: "cus_current",
        balance,
        currency: "eur",
      });

      await expect(
        retrieveStripeCustomerBalance("cus_current"),
      ).resolves.toEqual({
        status: "available",
        balanceMinorUnits: balance,
        currency: "eur",
      });
      expect(stripe.retrieveCustomer).toHaveBeenCalledWith("cus_current");
    },
  );

  it("represents a deleted Stripe customer without a value", async () => {
    stripe.retrieveCustomer.mockResolvedValue({
      id: "cus_current",
      deleted: true,
    });

    await expect(retrieveStripeCustomerBalance("cus_current")).resolves.toEqual(
      {
        status: "deleted",
        balanceMinorUnits: null,
        currency: null,
      },
    );
  });

  it("propagates provider failures for the public boundary to sanitize", async () => {
    const providerFailure = new Error("Stripe unavailable");
    stripe.retrieveCustomer.mockRejectedValue(providerFailure);

    await expect(retrieveStripeCustomerBalance("cus_current")).rejects.toBe(
      providerFailure,
    );
  });
});
