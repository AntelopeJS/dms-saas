import { fromPartial } from "@total-typescript/shoehorn";
import type Stripe from "stripe";
import { describe, expect, it } from "vitest";
import {
  firstChargedInvoice,
  toEligibilityResponse,
} from "../src/routes/tenant/billing-self-refund";

const seconds = (date: Date) => Math.floor(date.getTime() / 1000);

describe("money-back guarantee", () => {
  const firstPayment = seconds(new Date("2026-09-07T00:00:00.000Z"));
  const paidInvoice = {
    id: "in_first",
    amountPaid: 47040,
    refundable: 47040,
    created: firstPayment,
    periodStart: null,
    periodEnd: null,
    currency: "eur",
  };

  it("names the amount and when the window closes", () => {
    expect(
      toEligibilityResponse(
        {
          eligible: true,
          reason: null,
          windowDays: 30,
          mode: "full",
          invoice: paidInvoice,
          payments: [paidInvoice],
        },
        null,
      ),
    ).toEqual({
      eligible: true,
      reason: null,
      windowDays: 30,
      mode: "full",
      refundAmount: 47040,
      currency: "eur",
      paymentsCount: 1,
      firstPaymentAt: new Date("2026-09-07T00:00:00.000Z"),
      windowEndsAt: new Date("2026-10-07T00:00:00.000Z"),
      refundedAt: null,
    });
  });

  it("starts from the first invoice that took money, not a trial's", () => {
    const paid = (id: string, created: string, amountPaid: number) =>
      fromPartial<Stripe.Invoice>({
        id,
        created: seconds(new Date(created)),
        amount_paid: amountPaid,
      });
    const trial = paid("in_trial", "2026-09-01T00:00:00.000Z", 0);
    const first = paid("in_first", "2026-09-15T00:00:00.000Z", 2900);
    const renewal = paid("in_renewal", "2026-10-15T00:00:00.000Z", 2900);

    expect(firstChargedInvoice([renewal, first, trial])?.id).toBe("in_first");
    expect(firstChargedInvoice([trial])).toBeNull();
  });

  it("says when the window ended, without offering an amount", () => {
    const response = toEligibilityResponse(
      {
        eligible: false,
        reason: "window_expired",
        windowDays: 30,
        mode: "full",
        invoice: paidInvoice,
        payments: [],
      },
      null,
    );

    expect(response).toMatchObject({
      reason: "window_expired",
      refundAmount: null,
      windowEndsAt: new Date("2026-10-07T00:00:00.000Z"),
    });
  });
});
