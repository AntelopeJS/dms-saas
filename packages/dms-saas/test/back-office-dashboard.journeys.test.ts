import { z } from "zod";
import { expect, type Journey, test } from "./journeys/journey.ts";
import {
  countsById,
  DASHBOARD,
  DAY_MS,
  type DashboardItem,
  dashboardItem,
  putSubscription,
} from "./journeys/back-office.ts";
import {
  createPlan,
  fixture,
  register,
  saas,
  withConfig,
} from "./journeys/saas.ts";

const suspensionDate = z.object({
  description: z.object({
    params: z.object({ date: z.object({ value: z.string() }) }),
  }),
});

/** The shared seed of the dashboard journeys: two paid plans and six workspaces in every state that matters. */
async function seed(journey: Journey) {
  await createPlan(journey, "free", { order: 0 });
  const pro = await createPlan(journey, "pro", {
    price: 12000,
    interval: "year",
    order: 1,
    name: { en: "Pro" },
  });
  const team = await createPlan(journey, "team", {
    price: 50,
    interval: "month",
    order: 2,
    name: { en: "Team" },
  });
  const states = [
    ["yearly", pro.id, "active", false],
    ["monthly", team.id, "active", false],
    ["late", team.id, "past_due", false],
    ["trial", team.id, "trialing", false],
    ["gift", pro.id, "active", true],
  ] as const;
  for (const [name, planId, status, complimentary] of states) {
    const visitor = await register(journey, name);
    await putSubscription(journey, visitor.tenantId, planId, status, {
      complimentary,
    });
  }
  await register(journey, "free-one");
}

/** How far the suspension date a Needs attention card shows is from `expected`, in milliseconds. */
function suspensionDrift(
  card: DashboardItem | undefined,
  expected: Date,
): number {
  const shown = suspensionDate.parse(card).description.params.date.value;
  return Math.abs(Date.parse(shown) - expected.getTime());
}

test("the-headline-figures-normalise-and-count-only-paying-workspaces", async ({
  journey,
}) => {
  await seed(journey);
  const headline = await saas(
    journey,
    "the headline",
    "GET",
    `${DASHBOARD}/headline`,
  );
  const statuses = await saas(
    journey,
    "workspaces by status",
    "GET",
    `${DASHBOARD}/workspaces-by-status`,
  );
  const byPlan = await saas(
    journey,
    "plans by MRR",
    "GET",
    `${DASHBOARD}/plans-by-mrr`,
  );

  expect
    .soft(
      dashboardItem(headline, "mrr"),
      "MRR: 1000 (yearly 12000 / 12) + 50 + 50 (past due) = 1100.00 EUR in minor units, and ARR twelve months of it",
    )
    .toMatchObject({
      value: { params: { value: { value: 110000 } } },
      detail: { params: { arr: { value: 1320000 } } },
    });
  expect
    .soft(
      dashboardItem(headline, "paying"),
      "3 paying of 7 workspaces (the default one included); the gift, the free workspace and the default one are not paying; trialing: 1",
    )
    .toMatchObject({
      value: { params: { paying: 3, total: 7 } },
      detail: { params: { free: 3, trialing: 1 } },
    });
  expect.soft(countsById(statuses), "workspaces by status").toMatchObject({
    active: 2,
    trialing: 1,
    free: 3,
    past_due: 1,
    suspended: 0,
    pending_payment: 0,
    cancelled: 0,
  });
  expect
    .soft(byPlan.body, "Pro 1000 then Team 100, the paying workspaces only")
    .toMatchObject({
      items: [
        { title: "Pro", value: 1000 },
        { title: "Team", value: 100 },
      ],
    });
});

test("mrr-is-reported-in-the-configured-currency-only", async ({ journey }) => {
  await seed(journey);
  await withConfig(
    journey,
    { E2E_SAAS_REPORTING_CURRENCY: "usd" },
    async () => {
      const headline = await saas(
        journey,
        "the headline in usd",
        "GET",
        `${DASHBOARD}/headline`,
      );
      expect
        .soft(
          dashboardItem(headline, "mrr"),
          "the MRR is in USD (read in upper case) and 0, the EUR amounts are shown apart",
        )
        .toMatchObject({
          value: { params: { value: { currency: "USD", value: 0 } } },
        });
    },
  );
});

test("only-the-platform-owner-reads-the-dashboard", async ({ journey }) => {
  await createPlan(journey, "free");
  await register(journey, "snoop");
  for (const block of [
    "headline",
    "attention",
    "churn",
    "paid-invoices",
    "workspaces-by-status",
    "plans-by-mrr",
    "activity",
  ]) {
    for (const who of ["snoop", "anon"]) {
      const answer = await saas(
        journey,
        `${who} reads ${block}`,
        "GET",
        `${DASHBOARD}/${block}`,
        { as: who },
      );
      expect
        .soft([401, 403], `${who}: ${block} is refused`)
        .toContain(answer.status);
    }
  }
});

test("trials-ending-within-14-days-are-flagged-and-later-ones-are-not", async ({
  journey,
}) => {
  await createPlan(journey, "free", { order: 0 });
  const pro = await createPlan(journey, "pro", { price: 50, order: 1 });
  const soon = await register(journey, "soon");
  const edge = await register(journey, "edge");
  const later = await register(journey, "later");
  await putSubscription(journey, soon.tenantId, pro.id, "trialing", {
    endsInDays: 3,
  });
  await putSubscription(journey, edge.tenantId, pro.id, "trialing", {
    endsInDays: 13,
  });
  await putSubscription(journey, later.tenantId, pro.id, "trialing", {
    endsInDays: 15,
  });

  const headline = await saas(
    journey,
    "the headline",
    "GET",
    "/dashboard/headline",
  );
  expect
    .soft(
      dashboardItem(headline, "trials"),
      "all three trials are counted, two end within 14 days, and the card leads to the trials-ending view",
    )
    .toMatchObject({
      value: 3,
      detail: { params: { count: { value: 2 } } },
      to: "/modules/saas/customers/workspaces?view=trials-ending",
    });

  await putSubscription(journey, edge.tenantId, pro.id, "trialing", {
    endsInDays: 16,
  });
  const moved = await saas(
    journey,
    "the headline after the trial moved",
    "GET",
    "/dashboard/headline",
  );
  expect
    .soft(
      dashboardItem(moved, "trials"),
      "a trial pushed past the window leaves the flagged count",
    )
    .toMatchObject({ detail: { params: { count: { value: 1 } } } });
});

test("needs-attention-shows-past-due-workspaces-with-the-amount-and-first-suspension", async ({
  journey,
}) => {
  await createPlan(journey, "free", { order: 0 });
  const pro = await createPlan(journey, "pro", { price: 50, order: 1 });
  const none = await saas(
    journey,
    "attention with nothing past due",
    "GET",
    "/dashboard/attention",
  );
  const late = await register(journey, "late");
  const later = await register(journey, "laterstill");
  await putSubscription(journey, late.tenantId, pro.id, "past_due", {
    pastDueDaysAgo: 2,
  });
  await putSubscription(journey, later.tenantId, pro.id, "past_due", {
    pastDueDaysAgo: 5,
  });

  const attention = await saas(
    journey,
    "attention with two past due",
    "GET",
    "/dashboard/attention",
  );
  const card = dashboardItem(attention, "past_due");
  expect
    .soft(dashboardItem(none, "past_due"), "nothing past due: no card")
    .toBeUndefined();
  expect
    .soft(
      card,
      "count 2, amount at risk 100.00 EUR (two workspaces at 50), the card opens the Past due tab",
    )
    .toMatchObject({
      title: { params: { count: { value: 2 } } },
      description: { params: { amount: { value: 10000 } } },
      to: "/modules/saas/customers/workspaces?tab=past_due",
    });
  expect
    .soft(
      suspensionDrift(card, new Date(Date.now() - 5 * DAY_MS + 14 * DAY_MS)),
      "the first suspension is the oldest past-due day plus 14 days",
    )
    .toBeLessThan(DAY_MS);

  await saas(
    journey,
    "set the suspension delay to 30 days",
    "PUT",
    "/settings/billing",
    { body: { autoSuspendDelayDays: 30 } },
  );
  for (const tenantId of [late.tenantId, later.tenantId]) {
    await fixture(
      journey,
      "publish the workspace again",
      "POST",
      "/recompute",
      {
        tenantId,
      },
    );
  }
  const longer = await saas(
    journey,
    "attention after the delay changed",
    "GET",
    "/dashboard/attention",
  );
  expect
    .soft(
      suspensionDrift(
        dashboardItem(longer, "past_due"),
        new Date(Date.now() - 5 * DAY_MS + 30 * DAY_MS),
      ),
      "the suspension date follows the billing rule: oldest past-due day plus 30 days",
    )
    .toBeLessThan(DAY_MS);
});

test("workspaces-by-status-counts-every-billing-state", async ({ journey }) => {
  await createPlan(journey, "free", { order: 0 });
  const pro = await createPlan(journey, "pro", { price: 50, order: 1 });
  const states = [
    "past_due",
    "suspended",
    "pending_payment",
    "cancelled",
    "trialing",
    "active",
  ];
  for (const [index, status] of states.entries()) {
    const visitor = await register(journey, `state${index}`);
    await putSubscription(
      journey,
      visitor.tenantId,
      pro.id,
      status,
      status === "trialing" ? { endsInDays: 30 } : {},
    );
  }

  const answer = await saas(
    journey,
    "workspaces by status",
    "GET",
    "/dashboard/workspaces-by-status",
  );
  expect
    .soft(
      countsById(answer),
      "one of each paid state, and the default workspace is free",
    )
    .toMatchObject({
      active: 1,
      trialing: 1,
      past_due: 1,
      pending_payment: 1,
      suspended: 1,
      cancelled: 1,
      free: 1,
    });
});
