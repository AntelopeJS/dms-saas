import { fromPartial } from "@total-typescript/shoehorn";
import { describe, expect, it } from "vitest";
import {
  buildWorkspaceDirectoryFields,
  type DirectoryInputs,
  shouldLookUpPaidInvoice,
} from "../src/billing-state/directory";
import type { Plan, TenantBillingState, TenantSubscription } from "../src/db";

const DAY_MS = 86_400_000;
const NOW = new Date("2026-10-07T12:00:00Z");
const PERIOD_END = new Date("2026-10-31T00:00:00Z");
const PAST_DUE_SINCE = new Date("2026-09-30T00:00:00Z");
const UPDATED_AT = new Date("2026-09-20T00:00:00Z");

const BUSINESS = fromPartial<Plan>({
  _id: "plan_business",
  name: "Business",
  price: 49,
  currency: "eur",
  interval: "month",
  billingMode: "seat",
  maxMembers: 25,
});

function subscription(
  overrides: Partial<TenantSubscription> = {},
): TenantSubscription {
  return fromPartial<TenantSubscription>({
    status: "active",
    stripeSubscriptionId: "sub_1",
    isComplimentary: false,
    currentPeriodEnd: PERIOD_END,
    freeUntil: null,
    pastDueSince: null,
    updatedAt: UPDATED_AT,
    ...overrides,
  });
}

function inputs(overrides: Partial<DirectoryInputs> = {}): DirectoryInputs {
  return {
    billingState: "active",
    subscription: subscription(),
    plan: BUSINESS,
    seats: {
      members: 21,
      pendingInvites: 2,
      occupied: 23,
      platformSupport: [],
    },
    owner: { status: "joined", name: "Margaux Dubois", email: "m@n.eu" },
    policy: { autoSuspendDelayDays: 14, retentionDays: 30 },
    existing: undefined,
    hasPaidInvoice: false,
    reportingCurrency: "EUR",
    now: NOW,
    ...overrides,
  };
}

describe("workspace directory row", () => {
  it("carries the plan, its billed seats and the normalised MRR", () => {
    expect(buildWorkspaceDirectoryFields(inputs())).toMatchObject({
      planId: "plan_business",
      planName: "Business",
      planInterval: "month",
      planBillingMode: "seat",
      planUnitAmountMinor: 4_900,
      currency: "EUR",
      seats: 23,
      members: 21,
      pendingPlanId: null,
      mrrMinor: 112_700,
      reportingMrr: 1_127,
      isComplimentary: false,
    });
  });

  it("totals MRR billed in another currency apart from the reporting one", () => {
    expect(
      buildWorkspaceDirectoryFields(inputs({ reportingCurrency: "USD" })),
    ).toMatchObject({ mrrMinor: 112_700, reportingMrr: 0 });
  });

  it("dates the renewal of a paying workspace", () => {
    expect(buildWorkspaceDirectoryFields(inputs())).toMatchObject({
      renewalKind: "renews",
      renewsAt: PERIOD_END,
    });
  });

  it("dates the end of a trial, and bills nothing meanwhile", () => {
    const row = buildWorkspaceDirectoryFields(
      inputs({
        billingState: "trialing",
        subscription: subscription({ status: "trialing" }),
      }),
    );

    expect(row).toMatchObject({ renewalKind: "trial_ends", mrrMinor: 0 });
  });

  it("dates the end of complimentary access", () => {
    const freeUntil = new Date(NOW.getTime() + 4 * DAY_MS);
    const row = buildWorkspaceDirectoryFields(
      inputs({
        billingState: "free",
        subscription: subscription({
          stripeSubscriptionId: null,
          isComplimentary: true,
          freeUntil,
        }),
      }),
    );

    expect(row).toMatchObject({
      renewalKind: "free_until",
      renewsAt: freeUntil,
      isComplimentary: true,
      mrrMinor: 0,
    });
  });

  it("dates the automatic suspension of a past-due workspace", () => {
    const row = buildWorkspaceDirectoryFields(
      inputs({
        billingState: "past_due",
        subscription: subscription({
          status: "past_due",
          pastDueSince: PAST_DUE_SINCE,
        }),
      }),
    );

    expect(row.renewalKind).toBe("suspends");
    expect(row.renewsAt).toEqual(
      new Date(PAST_DUE_SINCE.getTime() + 14 * DAY_MS),
    );
    expect(row.mrrMinor).toBe(112_700);
  });

  it("dates no suspension when the automatic rule is off", () => {
    const row = buildWorkspaceDirectoryFields(
      inputs({
        billingState: "past_due",
        subscription: subscription({ status: "past_due" }),
        policy: { autoSuspendDelayDays: null, retentionDays: 30 },
      }),
    );

    expect(row).toMatchObject({ renewalKind: null, renewsAt: null });
  });

  it("dates the deletion of a cancelled workspace's data", () => {
    const row = buildWorkspaceDirectoryFields(
      inputs({
        billingState: "cancelled",
        subscription: subscription({ status: "cancelled" }),
      }),
    );

    expect(row.renewalKind).toBe("deletes");
    expect(row.renewsAt).toEqual(new Date(UPDATED_AT.getTime() + 30 * DAY_MS));
  });

  it("keeps the date a state began while it holds", () => {
    const since = new Date("2026-09-01T00:00:00Z");
    const row = buildWorkspaceDirectoryFields(
      inputs({
        billingState: "suspended",
        subscription: subscription({ status: "suspended" }),
        existing: fromPartial<TenantBillingState>({
          billingState: "suspended",
          stateSince: since,
        }),
      }),
    );

    expect(row).toMatchObject({
      stateSince: since,
      renewalKind: "suspended",
      renewsAt: since,
    });
  });

  it("starts the state's clock and keeps the MRR it had when the state changes", () => {
    const row = buildWorkspaceDirectoryFields(
      inputs({
        billingState: "cancelled",
        subscription: subscription({ status: "cancelled" }),
        existing: fromPartial<TenantBillingState>({
          billingState: "active",
          stateSince: new Date("2026-01-01T00:00:00Z"),
          mrrMinor: 112_700,
        }),
      }),
    );

    expect(row).toMatchObject({
      stateSince: NOW,
      mrrMinor: 0,
      previousMrrMinor: 112_700,
    });
  });

  it("dates a first observation from the subscription's own records", () => {
    const row = buildWorkspaceDirectoryFields(
      inputs({
        billingState: "past_due",
        subscription: subscription({
          status: "past_due",
          pastDueSince: PAST_DUE_SINCE,
        }),
      }),
    );

    expect(row.stateSince).toEqual(PAST_DUE_SINCE);
  });

  it("flags an owner who never joined", () => {
    const invited = buildWorkspaceDirectoryFields(
      inputs({ owner: { status: "invited", name: null, email: "o@x.io" } }),
    );
    const expired = buildWorkspaceDirectoryFields(
      inputs({ owner: { status: "expired", name: null, email: "o@x.io" } }),
    );
    const joined = buildWorkspaceDirectoryFields(inputs());

    expect(invited).toMatchObject({
      ownerNeverJoined: true,
      ownerEmail: "o@x.io",
    });
    expect(expired.ownerNeverJoined).toBe(true);
    expect(joined.ownerNeverJoined).toBe(false);
  });

  it("lists a workspace without a plan with no price nor MRR", () => {
    const row = buildWorkspaceDirectoryFields(inputs({ plan: null }));

    expect(row).toMatchObject({
      planId: null,
      planName: null,
      currency: null,
      mrrMinor: 0,
    });
  });
});

describe("workspace directory churn", () => {
  const cancelled = (overrides: Partial<DirectoryInputs> = {}) =>
    buildWorkspaceDirectoryFields(
      inputs({
        billingState: "cancelled",
        subscription: subscription({ status: "cancelled" }),
        ...overrides,
      }),
    );

  it("takes the loss of a cancellation first seen cancelled from the price last paid", () => {
    expect(cancelled({ hasPaidInvoice: true })).toMatchObject({
      mrrMinor: 0,
      previousMrrMinor: 112_700,
    });
  });

  it("counts no loss for a workspace that never paid, like a cancelled trial", () => {
    expect(cancelled({ hasPaidInvoice: false }).previousMrrMinor).toBe(0);
  });

  it("counts no loss for a gift or a free plan", () => {
    expect(
      cancelled({
        hasPaidInvoice: true,
        subscription: subscription({
          status: "cancelled",
          isComplimentary: true,
        }),
      }).previousMrrMinor,
    ).toBe(0);
    expect(
      cancelled({
        hasPaidInvoice: true,
        plan: fromPartial<Plan>({ ...BUSINESS, price: 0 }),
      }).previousMrrMinor,
    ).toBe(0);
  });

  it("passes the loss a suspension held on to the cancellation that follows", () => {
    const row = cancelled({
      existing: fromPartial<TenantBillingState>({
        billingState: "suspended",
        stateSince: new Date("2026-09-01T00:00:00Z"),
        mrrMinor: 0,
        previousMrrMinor: 112_700,
      }),
    });

    expect(row.previousMrrMinor).toBe(112_700);
  });

  it("keeps a cancelled trial's loss at nothing", () => {
    const row = cancelled({
      hasPaidInvoice: true,
      existing: fromPartial<TenantBillingState>({
        billingState: "trialing",
        stateSince: new Date("2026-09-01T00:00:00Z"),
        mrrMinor: 0,
        previousMrrMinor: 0,
      }),
    });

    expect(row.previousMrrMinor).toBe(0);
  });

  it("reads invoices only for a workspace first published suspended or cancelled", () => {
    const known = fromPartial<TenantBillingState>({
      billingState: "cancelled",
      mrrMinor: 0,
      previousMrrMinor: 4_900,
    });
    const unknown = fromPartial<TenantBillingState>({
      ...known,
      previousMrrMinor: 0,
    });

    expect(shouldLookUpPaidInvoice("cancelled", undefined)).toBe(true);
    expect(shouldLookUpPaidInvoice("suspended", undefined)).toBe(true);
    expect(shouldLookUpPaidInvoice("cancelled", unknown)).toBe(false);
    expect(shouldLookUpPaidInvoice("cancelled", known)).toBe(false);
    expect(shouldLookUpPaidInvoice("active", undefined)).toBe(false);
    expect(shouldLookUpPaidInvoice("trialing", undefined)).toBe(false);
  });
});
