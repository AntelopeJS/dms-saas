import { beforeEach, describe, expect, it, vi } from "vitest";

const stripe = vi.hoisted(() => ({
  prices: { retrieve: vi.fn() },
  subscriptionSchedules: { create: vi.fn(), update: vi.fn() },
}));
vi.mock("../src/stripe/client", () => ({ getStripeClient: () => stripe }));

import { scheduleSubscriptionDowngrade } from "../src/stripe/plan-schedule";

const PHASE_START = 1_790_000_000;
const PHASE_END = 1_792_592_000;
const MS_PER_SECOND = 1000;

beforeEach(() => {
  vi.clearAllMocks();
  stripe.subscriptionSchedules.create.mockResolvedValue({
    id: "sub_sched",
    phases: [
      {
        start_date: PHASE_START,
        end_date: PHASE_END,
        items: [{ price: { id: "price_pro" }, quantity: 1 }],
      },
    ],
  });
  stripe.subscriptionSchedules.update.mockResolvedValue({});
});

describe("scheduled downgrade", () => {
  it("sizes the next phase to one billing cycle of the target price", async () => {
    stripe.prices.retrieve.mockResolvedValue({
      id: "price_basic_yearly",
      recurring: { interval: "year", interval_count: 1 },
    });

    await expect(
      scheduleSubscriptionDowngrade({
        stripeSubscriptionId: "sub_1",
        stripePriceId: "price_basic_yearly",
      }),
    ).resolves.toEqual(new Date(PHASE_END * MS_PER_SECOND));

    const [, params] = stripe.subscriptionSchedules.update.mock.calls[0];
    expect(params.phases[1]).toEqual({
      items: [{ price: "price_basic_yearly", quantity: undefined }],
      duration: { interval: "year", interval_count: 1 },
      automatic_tax: { enabled: true },
    });
    expect(params.phases[1]).not.toHaveProperty("iterations");
    expect(params.phases[0]).toMatchObject({
      items: [{ price: "price_pro", quantity: 1 }],
      start_date: PHASE_START,
      end_date: PHASE_END,
    });
  });

  it("creates no schedule when the target price is not recurring", async () => {
    stripe.prices.retrieve.mockResolvedValue({ id: "price_once" });

    await expect(
      scheduleSubscriptionDowngrade({
        stripeSubscriptionId: "sub_1",
        stripePriceId: "price_once",
      }),
    ).rejects.toThrow("not recurring");
    expect(stripe.subscriptionSchedules.create).not.toHaveBeenCalled();
  });
});
