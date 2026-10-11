import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Plan, TenantSubscription } from "../src/db";
import type { WorkspaceOperatorView } from "../src/workspaces/operator-view";

const stripe = vi.hoisted(() => ({
  retrieve: vi.fn(async () => ({ items: { data: [{ id: "si_1" }] } })),
  createPreview: vi.fn(),
}));
const view = vi.hoisted(() => ({ load: vi.fn() }));
const target = vi.hoisted(() => ({ plan: null as unknown }));

vi.mock("../src/stripe/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/stripe/client")>()),
  getStripeClient: () => ({
    subscriptions: { retrieve: stripe.retrieve },
    invoices: { createPreview: stripe.createPreview },
    taxRates: { retrieve: vi.fn() },
  }),
}));
vi.mock("../src/workspaces/operator-view", () => ({
  loadWorkspaceOperatorView: view.load,
}));
vi.mock("../src/routes/tenant/tenant-plan-ops", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../src/routes/tenant/tenant-plan-ops")
  >()),
  loadAndValidateTargetPlan: async () => target.plan,
}));
vi.mock(
  "@antelopejs/interface-database-decorators",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("@antelopejs/interface-database-decorators")
    >()),
    GetModel: () => ({}),
  }),
);

import { previewManualUpgrade } from "../src/operator-actions/upgrade-preview";

const PERIOD_END = new Date("2026-10-31T00:00:00Z");

function plan(overrides: Partial<Plan>): Plan {
  return {
    _id: "plan_business",
    name: "Business",
    audience: "any",
    price: 49,
    currency: "eur",
    interval: "month",
    billingMode: "seat",
    maxMembers: 50,
    isActive: true,
    isDeleted: false,
    paymentProviderRefs: { stripePriceId: "price_business" },
    ...overrides,
  } as Plan;
}

function operatorView(current: Plan): WorkspaceOperatorView {
  return {
    plan: current,
    billingState: "active",
    billingInfo: { customerType: "business" },
    subscription: {
      stripeSubscriptionId: "sub_1",
      stripeCustomerId: "cus_1",
      currentPeriodEnd: PERIOD_END,
    } as TenantSubscription,
    seats: {
      members: 23,
      pendingInvites: 0,
      occupied: 23,
      platformSupport: [],
    },
    directory: { mrrMinor: 112_700 },
  } as unknown as WorkspaceOperatorView;
}

function stripePreview() {
  return {
    currency: "eur",
    lines: {
      has_more: false,
      data: [
        {
          description: "Remaining time on Enterprise",
          amount: 1_904_400,
          taxes: [],
          quantity: 23,
          period: { start: 1_790_000_000, end: 1_800_000_000 },
          parent: { subscription_item_details: { proration: true } },
          metadata: {},
        },
        {
          description: "Unused time on Business",
          amount: -109_285,
          taxes: [],
          quantity: 23,
          period: { start: 1_790_000_000, end: 1_800_000_000 },
          parent: { subscription_item_details: { proration: true } },
          metadata: {},
        },
      ],
    },
    subtotal: 1_795_115,
    subtotal_excluding_tax: 1_795_115,
    total_excluding_tax: 1_795_115,
    total_taxes: [],
    total: 1_795_115,
    amount_due: 1_795_115,
    period_start: 1_790_000_000,
    period_end: 1_800_000_000,
    customer_address: { country: "FR" },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  stripe.createPreview.mockResolvedValue(stripePreview());
});

describe("immediate upgrade preview", () => {
  it("asks Stripe to prorate the new price on the subscription", async () => {
    view.load.mockResolvedValue(operatorView(plan({})));
    target.plan = plan({
      _id: "plan_enterprise",
      name: "Enterprise",
      price: 828,
      interval: "year",
      paymentProviderRefs: { stripePriceId: "price_enterprise" },
    });

    await previewManualUpgrade("tenant-1", "plan_enterprise");

    expect(stripe.createPreview).toHaveBeenCalledWith(
      expect.objectContaining({
        customer: "cus_1",
        subscription: "sub_1",
        subscription_details: expect.objectContaining({
          items: [{ id: "si_1", price: "price_enterprise" }],
          proration_behavior: "create_prorations",
        }),
      }),
    );
  });

  it("charges now when the interval changes, and states the MRR change", async () => {
    view.load.mockResolvedValue(operatorView(plan({})));
    target.plan = plan({
      _id: "plan_enterprise",
      name: "Enterprise",
      price: 828,
      interval: "year",
      paymentProviderRefs: { stripePriceId: "price_enterprise" },
    });

    const preview = await previewManualUpgrade("tenant-1", "plan_enterprise");

    expect(preview).toMatchObject({
      isChargedNow: true,
      currency: "EUR",
      amountDueMinor: 1_795_115,
      renewalAmountMinor: 82_800 * 23,
      mrrBeforeMinor: 112_700,
      mrrAfterMinor: Math.round((82_800 * 23) / 12),
      current: { name: "Business", unitAmountMinor: 4_900 },
      target: { name: "Enterprise", unitAmountMinor: 82_800 },
    });
    expect(preview.lines.map((line) => line.isProration)).toEqual([true, true]);
  });

  it("adds the prorations to the next invoice when the interval stays", async () => {
    view.load.mockResolvedValue(
      operatorView(plan({ _id: "plan_team", name: "Team", price: 29 })),
    );
    target.plan = plan({});

    const preview = await previewManualUpgrade("tenant-1", "plan_business");

    expect(preview.isChargedNow).toBe(false);
    expect(preview.billingDate).toBe(PERIOD_END.toISOString());
  });

  it("refuses a target that is not an upgrade", async () => {
    view.load.mockResolvedValue(operatorView(plan({})));
    target.plan = plan({ _id: "plan_starter", name: "Starter", price: 9 });

    await expect(
      previewManualUpgrade("tenant-1", "plan_starter"),
    ).rejects.toMatchObject({
      status: 400,
      body: "saas.errors.operator.upgrade_not_eligible",
    });
    expect(stripe.createPreview).not.toHaveBeenCalled();
  });
});
