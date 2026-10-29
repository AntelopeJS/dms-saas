import { fromPartial } from "@total-typescript/shoehorn";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { scheduleSubscriptionDowngrade } from "../src/stripe/plan-schedule";
import { useSuiteStripe } from "./helpers/stripe";

const stripe = useSuiteStripe();

function stubScheduleCalls() {
  return {
    retrievePrice: vi.spyOn(stripe.write.prices, "retrieve"),
    createSchedule: vi.spyOn(stripe.write.subscriptionSchedules, "create"),
    updateSchedule: vi.spyOn(stripe.write.subscriptionSchedules, "update"),
  };
}

let api: ReturnType<typeof stubScheduleCalls>;

const PHASE_START = 1_790_000_000;
const PHASE_END = 1_792_592_000;
const MS_PER_SECOND = 1000;

beforeEach(() => {
  api = stubScheduleCalls();
  api.createSchedule.mockResolvedValue(
    fromPartial({
      id: "sub_sched",
      phases: [
        {
          start_date: PHASE_START,
          end_date: PHASE_END,
          items: [{ price: { id: "price_pro" }, quantity: 1 }],
        },
      ],
    }),
  );
  api.updateSchedule.mockResolvedValue(fromPartial({}));
});

describe("scheduled downgrade", () => {
  it("sizes the next phase to one billing cycle of the target price", async () => {
    api.retrievePrice.mockResolvedValue(
      fromPartial({
        id: "price_basic_yearly",
        recurring: { interval: "year", interval_count: 1 },
      }),
    );

    await expect(
      scheduleSubscriptionDowngrade({
        stripeSubscriptionId: "sub_1",
        stripePriceId: "price_basic_yearly",
      }),
    ).resolves.toEqual(new Date(PHASE_END * MS_PER_SECOND));

    const [, params] = api.updateSchedule.mock.calls[0];
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

  it("keeps the trial of a trialing subscription in the running phase", async () => {
    api.retrievePrice.mockResolvedValue(
      fromPartial({
        id: "price_starter",
        recurring: { interval: "month", interval_count: 1 },
      }),
    );
    api.createSchedule.mockResolvedValue(
      fromPartial({
        id: "sub_sched",
        phases: [
          {
            start_date: PHASE_START,
            end_date: PHASE_END,
            trial_end: PHASE_END,
            items: [{ price: { id: "price_pro" }, quantity: 1 }],
          },
        ],
      }),
    );

    await scheduleSubscriptionDowngrade({
      stripeSubscriptionId: "sub_1",
      stripePriceId: "price_starter",
    });

    const [, params] = api.updateSchedule.mock.calls[0];
    expect(params.phases[0]).toMatchObject({ trial_end: PHASE_END });
    expect(params.phases[1]).not.toHaveProperty("trial_end");
  });

  it("adds no trial to a phase that has none", async () => {
    api.retrievePrice.mockResolvedValue(
      fromPartial({
        id: "price_starter",
        recurring: { interval: "month", interval_count: 1 },
      }),
    );

    await scheduleSubscriptionDowngrade({
      stripeSubscriptionId: "sub_1",
      stripePriceId: "price_starter",
    });

    const [, params] = api.updateSchedule.mock.calls[0];
    expect(params.phases[0]).not.toHaveProperty("trial_end");
  });

  it("creates no schedule when the target price is not recurring", async () => {
    api.retrievePrice.mockResolvedValue(fromPartial({ id: "price_once" }));

    await expect(
      scheduleSubscriptionDowngrade({
        stripeSubscriptionId: "sub_1",
        stripePriceId: "price_once",
      }),
    ).rejects.toThrow("not recurring");
    expect(api.createSchedule).not.toHaveBeenCalled();
  });
});
