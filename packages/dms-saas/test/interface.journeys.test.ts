import { type Answer, expect, type Journey, test } from "./journeys/journey.ts";
import { createPlan, fixture, register } from "./journeys/saas.ts";
import { ANY_STRING } from "./helpers/asymmetric-matchers.ts";

/** Calls one billing function of @antelopejs/interface-dms-saas through the playground, as a consuming module does. */
function call(
  journey: Journey,
  name: "balance" | "preview" | "period",
  scope: { tenantId: string; userId?: string },
): Promise<Answer> {
  return fixture(
    journey,
    `${name} of ${JSON.stringify(scope)}`,
    "POST",
    `/interface/${name}`,
    scope,
  );
}

test("the-billing-reads-answer-absent-for-a-free-and-a-gifted-workspace", async ({
  journey,
}) => {
  await createPlan(journey, "free");
  const pro = await createPlan(journey, "pro", { price: 20, order: 1 });
  const free = await register(journey, "free-owner");
  const gift = await register(journey, "gift-owner");
  const paid = await register(journey, "paid-owner");
  await fixture(journey, "gift the pro plan", "POST", "/subscription", {
    tenantId: gift.tenantId,
    planId: pro.id,
    status: "active",
    isComplimentary: true,
    stripeCustomerId: "cus_gift",
  });
  await fixture(journey, "bill the pro plan", "POST", "/subscription", {
    tenantId: paid.tenantId,
    planId: pro.id,
    status: "active",
    stripeCustomerId: "cus_iface",
    stripeSubscriptionId: "sub_iface",
  });
  const scope = ({
    tenantId,
    userId,
  }: {
    tenantId: string;
    userId: string;
  }) => ({
    tenantId,
    userId,
  });

  const freeBalance = await call(journey, "balance", scope(free));
  expect
    .soft(freeBalance.body, "a free workspace has no balance, never a zero")
    .toMatchObject({
      result: {
        status: "absent",
        reason: "customer_not_configured",
        balanceMinorUnits: null,
        currency: null,
      },
    });
  const giftBalance = await call(journey, "balance", scope(gift));
  expect
    .soft(giftBalance.body, "a gifted workspace has no balance")
    .toMatchObject({ result: { status: "absent", reason: "complimentary" } });

  const freePreview = await call(journey, "preview", scope(free));
  expect
    .soft(freePreview.body, "a free workspace has no preview")
    .toMatchObject({
      result: { status: "absent", reason: "free_plan", computedAt: ANY_STRING },
    });
  const giftPreview = await call(journey, "preview", scope(gift));
  expect
    .soft(giftPreview.body, "a gifted workspace has no preview")
    .toMatchObject({ result: { reason: "complimentary" } });
  const paidPreview = await call(journey, "preview", scope(paid));
  expect
    .soft(paidPreview.body, "a billed workspace without a usable Stripe key")
    .toMatchObject({
      result: {
        status: "unavailable",
        reason: "stripe_not_configured",
        computedAt: ANY_STRING,
      },
    });

  const outsider = { tenantId: free.tenantId, userId: gift.userId };
  const outsiderBalance = await call(journey, "balance", outsider);
  expect
    .soft(outsiderBalance.body, "a non-member reads no balance")
    .toMatchObject({
      ok: false,
    });
  expect
    .soft(JSON.stringify(outsiderBalance.body))
    .toContain("error.tenant_member_required");
  const outsiderPreview = await call(journey, "preview", outsider);
  expect
    .soft(outsiderPreview.body, "a non-member reads no preview")
    .toMatchObject({
      ok: false,
    });

  for (const [who, owner] of [
    ["free", free],
    ["gifted", gift],
    ["billed without a recorded period", paid],
  ] as const) {
    const period = await call(journey, "period", { tenantId: owner.tenantId });
    expect
      .soft(period.body, `the billing period of a ${who} workspace`)
      .toMatchObject({ ok: true, result: null });
  }
});
