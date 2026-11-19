import { z } from "zod";
import { type Answer, expect, test } from "./journeys/journey.ts";
import {
  availablePlan,
  dashboardItem,
  dayStamp,
  mirrorDocument,
  putSubscription,
} from "./journeys/back-office.ts";
import {
  allPermissionIds,
  createPlan,
  fixture,
  joinMember,
  register,
  saas,
} from "./journeys/saas.ts";

const chart = z.object({
  series: z.array(
    z.object({
      name: z.string(),
      data: z.array(z.object({ y: z.coerce.number() })),
    }),
  ),
});

/** The sum of the series of a chart answer whose name ends with `suffix`. */
function seriesTotal(answer: Answer, suffix: string): number {
  const series = chart
    .parse(answer.body)
    .series.find((entry) => entry.name.endsWith(suffix));
  return (series?.data ?? []).reduce((sum, point) => sum + point.y, 0);
}

test("churn-counts-a-cancellation-that-followed-a-suspension", async ({
  journey,
}) => {
  await createPlan(journey, "free", { order: 0 });
  const pro = await createPlan(journey, "pro", { price: 50, order: 1 });
  const keeper = await register(journey, "stays");
  const leaver = await register(journey, "goes");
  await putSubscription(journey, keeper.tenantId, pro.id, "active");
  await putSubscription(journey, leaver.tenantId, pro.id, "active");

  for (const status of ["past_due", "suspended"]) {
    await putSubscription(journey, leaver.tenantId, pro.id, status);
    const mid = await saas(
      journey,
      `churn while ${status}`,
      "GET",
      "/dashboard/churn",
    );
    expect
      .soft(mid.body, `while ${status} nothing is lost yet: 0 %`)
      .toMatchObject({ value: 0 });
  }
  await putSubscription(journey, leaver.tenantId, pro.id, "cancelled");

  const churn = await saas(
    journey,
    "churn after the cancellation",
    "GET",
    "/dashboard/churn",
  );
  expect
    .soft(
      churn.body,
      "the cancellation counts what was paid before the workspace fell past due: 50 / (50 + 50) = 50 %",
    )
    .toMatchObject({ value: 50 });
});

test("revenue-churn-divides-the-lost-mrr-by-the-mrr-the-period-started-with", async ({
  journey,
}) => {
  await createPlan(journey, "free", { order: 0 });
  const pro = await createPlan(journey, "pro", { price: 50, order: 1 });
  const keeper = await register(journey, "keeper");
  const leaver = await register(journey, "leaver");
  const never = await register(journey, "never-paid");
  await putSubscription(journey, keeper.tenantId, pro.id, "active");
  await putSubscription(journey, leaver.tenantId, pro.id, "active");
  await mirrorDocument(journey, leaver.tenantId, {
    number: "L-1",
    documentType: "invoice",
    status: "paid",
    totalMinor: 5000,
    daysAgo: 20,
  });
  const before = await saas(
    journey,
    "churn before any cancellation",
    "GET",
    "/dashboard/churn",
  );
  await putSubscription(journey, leaver.tenantId, pro.id, "cancelled");
  await putSubscription(journey, never.tenantId, pro.id, "trialing");
  await putSubscription(journey, never.tenantId, pro.id, "cancelled");
  const after = await saas(
    journey,
    "churn after the cancellations",
    "GET",
    "/dashboard/churn",
  );
  const past = await saas(
    journey,
    "churn over a period before the cancellations",
    "GET",
    `/dashboard/churn?from=${dayStamp(90)}&to=${dayStamp(60)}`,
  );

  expect.soft(before.body, "before: 0 %").toMatchObject({ value: 0 });
  expect
    .soft(after.body, "one paying workspace left (50) and 50 lost: 50 %")
    .toMatchObject({ value: 50 });
  expect
    .soft(past.body, "a period that ends before the cancellations: 0 %")
    .toMatchObject({ value: 0 });
});

test("paid-invoices-sums-collected-and-credited-money-per-day-with-a-comparison", async ({
  journey,
}) => {
  await createPlan(journey, "free");
  const payer = await register(journey, "invoice-payer");
  const documents = [
    ["P-1", "invoice", "paid", 4900, 3],
    ["P-2", "invoice", "paid", 1000, 10],
    ["O-1", "invoice", "open", 7000, 2],
    ["V-1", "invoice", "void", 3000, 2],
    ["C-1", "credit_note", "issued", 1500, 4],
    ["OLD-1", "invoice", "paid", 8000, 45],
  ] as const;
  for (const [number, documentType, status, totalMinor, daysAgo] of documents) {
    await mirrorDocument(journey, payer.tenantId, {
      number,
      documentType,
      status,
      totalMinor,
      daysAgo,
    });
  }

  const current = await saas(
    journey,
    "paid invoices over 30 days",
    "GET",
    `/dashboard/paid-invoices?from=${dayStamp(29)}&to=${dayStamp(0)}`,
  );
  expect
    .soft(current.body, "collected in the period: 49.00 + 10.00 = 59")
    .toMatchObject({ value: 59 });
  expect
    .soft(seriesTotal(current, "collected"), "the collected series sums to 59")
    .toBe(59);
  expect
    .soft(seriesTotal(current, "credited"), "the credited series sums to 15")
    .toBe(15);
  expect
    .soft(current.body, "no comparison without a comparison window")
    .not.toHaveProperty("previousValue");

  const compared = await saas(
    journey,
    "paid invoices with a comparison window",
    "GET",
    `/dashboard/paid-invoices?from=${dayStamp(29)}&to=${dayStamp(0)}&compareFrom=${dayStamp(59)}&compareTo=${dayStamp(30)}&comparison=previous`,
  );
  expect
    .soft(
      compared.body,
      "the earlier window collected 80, the value moved from 80 to 59: -26.25 %, and a comparison series is returned",
    )
    .toMatchObject({
      previousValue: 80,
      delta: -26.25,
      comparisonSeries: [{}],
    });

  const none = await saas(
    journey,
    "paid invoices with No comparison",
    "GET",
    `/dashboard/paid-invoices?from=${dayStamp(29)}&to=${dayStamp(0)}&comparison=none`,
  );
  expect
    .soft(none.body, "no previous value, no delta, no comparison series")
    .not.toHaveProperty("previousValue");
  expect.soft(none.body).not.toHaveProperty("delta");
  expect.soft(none.body).not.toHaveProperty("comparisonSeries");
});

test("the-invoice-figures-count-the-right-statuses-and-periods", async ({
  journey,
}) => {
  await createPlan(journey, "free");
  const { tenantId } = await register(journey, "billed");
  const invoices = [
    ["F-OPEN", "open", 7000, 1],
    ["F-PAID", "paid", 4900, 0],
    ["F-OLDPAID", "paid", 2000, 400],
    ["F-UNC", "uncollectible", 3000, 5],
    ["F-UNCOLD", "uncollectible", 9000, 400],
    ["F-DRAFT", "draft", 500, 0],
  ] as const;
  for (const [number, status, totalMinor, daysAgo] of invoices) {
    await mirrorDocument(journey, tenantId, {
      number,
      documentType: "invoice",
      status,
      totalMinor,
      daysAgo,
    });
  }
  const notes = [
    [
      "an issued credit to balance",
      "N-1",
      1500,
      "issued",
      "credit_to_balance",
      false,
    ],
    ["an issued refund", "N-2", 2500, "issued", "refund", true],
    ["a void credit note", "N-3", 9900, "void", "credit_to_balance", false],
  ] as const;
  for (const [label, number, amountMinor, status, type, refunded] of notes) {
    await fixture(journey, label, "POST", "/credit-note", {
      tenantId,
      number,
      amountMinor,
      status,
      type,
      refunded,
    });
  }

  const figures = await saas(
    journey,
    "the invoice figures",
    "GET",
    "/billing-stats/invoices",
  );
  expect
    .soft(
      dashboardItem(figures, "awaiting"),
      "awaiting payment: the open invoice, 70.00, count 1",
    )
    .toMatchObject({
      value: { params: { value: { value: 7000 } } },
      detail: { params: { count: { value: 1 } } },
    });
  expect
    .soft(
      dashboardItem(figures, "collected"),
      "collected this month: only the paid invoice of this month, 49.00, count 1",
    )
    .toMatchObject({
      value: { params: { value: { value: 4900 } } },
      detail: { params: { count: { value: 1 } } },
    });
  expect
    .soft(
      dashboardItem(figures, "credited"),
      "credited this month: the two issued notes, 40.00, count 2, a void one ignored",
    )
    .toMatchObject({
      value: { params: { value: { value: 4000 } } },
      detail: { params: { count: { value: 2 } } },
    });
  expect
    .soft(
      dashboardItem(figures, "written_off"),
      "written off this year: this year's uncollectible only, 30.00, count 1",
    )
    .toMatchObject({
      value: { params: { value: { value: 3000 } } },
      detail: { params: { count: { value: 1 } } },
    });

  const split = await saas(
    journey,
    "the credit note figures",
    "GET",
    "/billing-stats/credit-notes",
  );
  expect
    .soft(dashboardItem(split, "credited"), "credited: 40.00")
    .toMatchObject({ value: { params: { value: { value: 4000 } } } });
  expect
    .soft(dashboardItem(split, "refunded"), "refunded to cards: 25.00, count 1")
    .toMatchObject({
      value: { params: { value: { value: 2500 } } },
      detail: { params: { count: { value: 1 } } },
    });
});

test("plans-by-mrr-ignores-trialing-workspaces-and-the-change-plan-list-fits-the-workspace", async ({
  journey,
}) => {
  const permissions = await allPermissionIds(journey);
  await createPlan(journey, "free", { order: 0, permissions });
  const team = await createPlan(journey, "team", {
    price: 50,
    order: 1,
    name: { en: "Team" },
    permissions,
  });
  await createPlan(journey, "tiny", {
    price: 5,
    order: 2,
    maxMembers: 1,
    name: { en: "Tiny" },
  });
  await createPlan(journey, "bizonly", {
    price: 9,
    order: 3,
    audience: "business",
    name: { en: "Bizonly" },
  });
  await createPlan(journey, "roomy", {
    price: 7,
    order: 4,
    maxMembers: 10,
    name: { en: "Roomy" },
  });
  const paying = await register(journey, "pays", { workspaceName: "Pays Co" });
  const trial = await register(journey, "tries", { workspaceName: "Tries Co" });
  await putSubscription(journey, paying.tenantId, team.id, "active");
  await putSubscription(journey, trial.tenantId, team.id, "trialing");

  const byPlan = await saas(
    journey,
    "plans by MRR",
    "GET",
    "/dashboard/plans-by-mrr",
  );
  expect
    .soft(byPlan.body, "one plan listed, Team: MRR 50, one workspace")
    .toMatchObject({
      items: [
        {
          title: "Team",
          value: 50,
          description: { params: { count: { value: 1 } } },
        },
      ],
    });

  const member = await joinMember(journey, "pays", "second-seat");
  await fixture(
    journey,
    "the paying workspace is an individual",
    "POST",
    "/customer-type",
    { tenantId: paying.tenantId, customerType: "individual" },
  );
  await fixture(
    journey,
    "the trialing workspace has no customer type",
    "POST",
    "/customer-type",
    { tenantId: trial.tenantId, customerType: null },
  );
  const untyped = await saas(
    journey,
    "the plans a workspace with no customer type is offered",
    "GET",
    "/tenant/plan",
    { as: "tries" },
  );
  const options = await saas(
    journey,
    "the plans the workspace may switch to",
    "GET",
    "/tenant/plan",
    { as: "pays" },
  );

  expect(member.ok, "the second member joined").toBe(true);
  expect
    .soft(options.body, "two seats are in use")
    .toMatchObject({ seats: { occupied: 2 } });
  expect
    .soft(
      availablePlan(options, "Tiny"),
      "a one-member plan is smaller than the seats in use",
    )
    .toMatchObject({ maxMembers: 1 });
  expect
    .soft(
      availablePlan(options, "Roomy"),
      "a plan with room is large enough, and a plan for anyone is offered",
    )
    .toMatchObject({ maxMembers: 10, isOfferedToCustomerType: true });
  expect
    .soft(
      availablePlan(options, "Bizonly"),
      "a business plan is not offered to an individual workspace",
    )
    .toMatchObject({ isOfferedToCustomerType: false });
  expect
    .soft(
      availablePlan(untyped, "Bizonly"),
      "a workspace with no customer type is offered every plan, Bizonly included",
    )
    .toMatchObject({ isOfferedToCustomerType: true });
});
