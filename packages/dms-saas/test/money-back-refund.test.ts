import type { User } from "@antelopejs/interface-dms/auth/db";
import { fromPartial } from "@total-typescript/shoehorn";
import type Stripe from "stripe";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  BillingSettingsModel,
  TenantSubscription,
  TenantSubscriptionModel,
} from "../src/db";
import {
  chargedInvoicesInWindow,
  SaasBillingSelfRefundController,
} from "../src/routes/tenant/billing-self-refund";
import { useSuiteStripe } from "./helpers/stripe";

const stripe = useSuiteStripe();

const DAY_SECONDS = 86_400;
const NOW_SECONDS = Math.floor(Date.now() / 1000);
const WINDOW_DAYS = 30;

function paid(
  id: string,
  daysAgo: number,
  amountPaid: number,
  credited = 0,
): Stripe.Invoice {
  const created = NOW_SECONDS - daysAgo * DAY_SECONDS;
  return {
    id,
    created,
    amount_paid: amountPaid,
    post_payment_credit_notes_amount: credited,
    currency: "eur",
    lines: {
      data: [
        {
          period: { start: created, end: created + WINDOW_DAYS * DAY_SECONDS },
        },
      ],
    },
  } as unknown as Stripe.Invoice;
}

const subscription = {
  _id: "acme",
  stripeCustomerId: "cus_acme",
  stripeSubscriptionId: "sub_acme",
  refundRequestedAt: null,
} as unknown as TenantSubscription;

const subscriptionModel = {
  findOne: async () => subscription,
  claimSelfRefund: vi.fn(async () => true),
  releaseSelfRefund: vi.fn(async () => undefined),
} as unknown as TenantSubscriptionModel;

function settings(mode: string) {
  return {
    get: async () => ({
      moneyBackGuaranteeEnabled: true,
      moneyBackGuaranteeWindowDays: WINDOW_DAYS,
      moneyBackGuaranteeMode: mode,
    }),
  } as unknown as BillingSettingsModel;
}

const owner = { _id: "owner" } as User;
const controller = new SaasBillingSelfRefundController();

/**
 * A first payment 10 days ago, an upgrade paid 5 days ago within the window,
 * and a trial's zero invoice before both.
 */
const INVOICES = [
  paid("in_upgrade", 5, 12098),
  paid("in_first", 10, 2900),
  paid("in_trial", 20, 0),
];

function stubRefundCalls() {
  return {
    listInvoices: vi
      .spyOn(stripe.write.invoices, "list")
      .mockResolvedValue(fromPartial({ data: INVOICES, has_more: false })),
    cancelSubscription: vi
      .spyOn(stripe.write.subscriptions, "cancel")
      .mockResolvedValue(fromPartial({})),
    createCreditNote: vi
      .spyOn(stripe.write.creditNotes, "create")
      .mockResolvedValue(fromPartial({})),
  };
}

let api: ReturnType<typeof stubRefundCalls>;

beforeEach(() => {
  vi.clearAllMocks();
  api = stubRefundCalls();
});

describe("money-back guarantee over several payments", () => {
  it("covers every charged invoice within the window of the first", () => {
    const later = paid("in_after_window", -25, 2900);

    expect(
      chargedInvoicesInWindow([later, ...INVOICES], WINDOW_DAYS).map(
        (invoice) => invoice.id,
      ),
    ).toEqual(["in_first", "in_upgrade"]);
  });

  it("offers back the sum of the payments made within the window", async () => {
    const eligibility = await controller.getRefundEligibility(
      owner,
      settings("full"),
      subscriptionModel,
    );

    expect(eligibility).toMatchObject({
      eligible: true,
      refundAmount: 2900 + 12098,
      paymentsCount: 2,
    });
  });

  it("refunds each payment with its own credit note, after cancelling", async () => {
    const result = await controller.requestSelfRefund(
      owner,
      settings("full"),
      subscriptionModel,
    );

    expect(result).toEqual({ refunded: 2900 + 12098 });
    expect(api.cancelSubscription).toHaveBeenCalledBefore(api.createCreditNote);
    expect(
      api.createCreditNote.mock.calls.map(([params, options]) => [
        params.invoice,
        params.refund_amount,
        options.idempotencyKey,
      ]),
    ).toEqual([
      ["in_first", 2900, "refund-self:acme:in_first"],
      ["in_upgrade", 12098, "refund-self:acme:in_upgrade"],
    ]);
  });

  it("never refunds more than what is left after earlier credit notes", async () => {
    api.listInvoices.mockResolvedValue(
      fromPartial({
        data: [paid("in_upgrade", 5, 12098, 12098), paid("in_first", 10, 2900)],
        has_more: false,
      }),
    );

    const result = await controller.requestSelfRefund(
      owner,
      settings("full"),
      subscriptionModel,
    );

    expect(result).toEqual({ refunded: 2900 });
    expect(api.createCreditNote).toHaveBeenCalledTimes(1);
  });

  it("prorates each payment over the period it paid for", async () => {
    const eligibility = await controller.getRefundEligibility(
      owner,
      settings("prorated"),
      subscriptionModel,
    );

    const unused = (amount: number, daysAgo: number) =>
      Math.floor(amount * ((WINDOW_DAYS - daysAgo) / WINDOW_DAYS));
    expect(eligibility.refundAmount).toBeCloseTo(
      unused(2900, 10) + unused(12098, 5),
      -1,
    );
  });
});
