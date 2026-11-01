import { fromPartial } from "@total-typescript/shoehorn";
import type Stripe from "stripe";
import { describe, expect, it, vi } from "vitest";
import { retrieveStripeCustomerBalance } from "../src/stripe/customer-balance";
import { useSuiteStripe } from "./helpers/stripe";

const stripe = useSuiteStripe();

function stubCustomer(
  customer: Partial<Stripe.Customer> | Partial<Stripe.DeletedCustomer>,
) {
  return vi
    .spyOn(stripe.write.customers, "retrieve")
    .mockResolvedValue(fromPartial(customer));
}

describe("Stripe customer balance adapter", () => {
  it.each([1_000, 0, -1_000])(
    "preserves Stripe's signed minor-unit balance %i",
    async (balance) => {
      const retrieve = stubCustomer({
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
      expect(retrieve).toHaveBeenCalledWith("cus_current");
    },
  );

  it("represents a deleted Stripe customer without a value", async () => {
    stubCustomer({ id: "cus_current", deleted: true });

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
    vi.spyOn(stripe.write.customers, "retrieve").mockRejectedValue(
      providerFailure,
    );

    await expect(retrieveStripeCustomerBalance("cus_current")).rejects.toBe(
      providerFailure,
    );
  });
});
