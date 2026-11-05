import { GetModel } from "@antelopejs/interface-database-decorators";
import { fromPartial } from "@total-typescript/shoehorn";
import type Stripe from "stripe";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { type BillingSettingsModel, TenantSubscriptionModel } from "../src/db";
import {
  chargedInvoicesInWindow,
  SaasBillingSelfRefundController,
} from "../src/routes/tenant/billing-self-refund";
import { useDmsAuth } from "./helpers/dms";
import { useMongoDatabase } from "./helpers/mongo";
import { useSuiteStripe } from "./helpers/stripe";
import {
  createOwnedWorkspace,
  type OwnedWorkspace,
} from "./helpers/workspaces";

useMongoDatabase("money-back-refund");
useDmsAuth();
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
  return fromPartial<Stripe.Invoice>({
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
  });
}

function settings(mode: string) {
  return fromPartial<BillingSettingsModel>({
    get: async () => ({
      moneyBackGuaranteeEnabled: true,
      moneyBackGuaranteeWindowDays: WINDOW_DAYS,
      moneyBackGuaranteeMode: mode,
    }),
  });
}

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
let workspace: OwnedWorkspace;

beforeEach(async () => {
  vi.clearAllMocks();
  api = stubRefundCalls();
  workspace = await createOwnedWorkspace();
  await GetModel(TenantSubscriptionModel, workspace.tenantId).insert({
    _id: workspace.tenantId,
    stripeCustomerId: "cus_acme",
    stripeSubscriptionId: "sub_acme",
    refundRequestedAt: null,
  });
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
      workspace.owner,
      settings("full"),
      workspace.request,
    );

    expect(eligibility).toMatchObject({
      eligible: true,
      refundAmount: 2900 + 12098,
      paymentsCount: 2,
    });
  });

  it("refunds each payment with its own credit note, after cancelling", async () => {
    const result = await controller.requestSelfRefund(
      workspace.owner,
      settings("full"),
      workspace.request,
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
      ["in_first", 2900, `refund-self:${workspace.tenantId}:in_first`],
      ["in_upgrade", 12098, `refund-self:${workspace.tenantId}:in_upgrade`],
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
      workspace.owner,
      settings("full"),
      workspace.request,
    );

    expect(result).toEqual({ refunded: 2900 });
    expect(api.createCreditNote).toHaveBeenCalledTimes(1);
  });

  it("prorates each payment over the period it paid for", async () => {
    const eligibility = await controller.getRefundEligibility(
      workspace.owner,
      settings("prorated"),
      workspace.request,
    );

    const unused = (amount: number, daysAgo: number) =>
      Math.floor(amount * ((WINDOW_DAYS - daysAgo) / WINDOW_DAYS));
    expect(eligibility.refundAmount).toBeCloseTo(
      unused(2900, 10) + unused(12098, 5),
      -1,
    );
  });
});
