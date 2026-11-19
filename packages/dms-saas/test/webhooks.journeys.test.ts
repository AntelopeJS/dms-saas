import { setTimeout as sleep } from "node:timers/promises";
import { ANY_STRING } from "./helpers/asymmetric-matchers.ts";
import { expect, test } from "./journeys/journey.ts";
import {
  createPlan,
  deliverEvent,
  fixture,
  register,
  saas,
  type StripeEvent,
} from "./journeys/saas.ts";
import {
  admitted,
  cancellationNotices,
  holder,
  now,
  rowOf,
  statusOf,
  stripeInvoice,
  stripeSubscription,
} from "./journeys/webhooks.ts";

const SIGNATURE_ERROR = "saas.errors.webhook.invalid_signature";

test("a-delivery-needs-a-valid-signature", async ({ journey }) => {
  const event: StripeEvent = {
    type: "product.created",
    id: "evt_sig_ok",
    object: { id: "prod_1" },
  };
  const unsigned = await deliverEvent(
    journey,
    { ...event, id: "evt_sig_none" },
    { secret: null },
  );
  const wrong = await deliverEvent(
    journey,
    { ...event, id: "evt_sig_wrong" },
    { secret: "whsec_someone_else" },
  );
  const stale = await deliverEvent(
    journey,
    { ...event, id: "evt_sig_stale" },
    { timestamp: now() - 600 },
  );
  const none = await admitted(journey);
  expect
    .soft(unsigned, "no signature: 400 saas.errors.webhook.invalid_signature")
    .toEqual({ status: 400, body: SIGNATURE_ERROR });
  expect
    .soft(wrong, "another secret: 400 saas.errors.webhook.invalid_signature")
    .toEqual({ status: 400, body: SIGNATURE_ERROR });
  expect
    .soft(stale, "a timestamp outside the five-minute tolerance: 400")
    .toEqual({ status: 400, body: SIGNATURE_ERROR });
  expect.soft(none, "no event was admitted").toEqual([]);

  const good = await deliverEvent(journey, event);
  expect
    .soft(good, "a correctly signed delivery: 200 { received: true }")
    .toEqual({ status: 200, body: { received: true } });
});

test("an-event-the-module-does-not-handle-is-recorded-skipped-once", async ({
  journey,
}) => {
  const unhandled: StripeEvent = {
    type: "product.created",
    id: "evt_skip_1",
    object: { id: "prod_9" },
  };
  const first = await deliverEvent(journey, unhandled);
  const again = await deliverEvent(journey, unhandled);
  const rows = await admitted(journey);
  expect.soft(first.status, "the first delivery is acknowledged").toBe(200);
  expect.soft(again.status, "the redelivery is acknowledged").toBe(200);
  expect
    .soft(rows, "one record for the event id: product.created, skipped")
    .toEqual([
      { id: "evt_skip_1", type: "product.created", result: "skipped" },
    ]);

  const other = await deliverEvent(journey, {
    type: "price.created",
    id: "evt_skip_2",
    object: { id: "price_1" },
  });
  const all = await admitted(journey);
  expect
    .soft(other.status, "another unhandled event is acknowledged")
    .toBe(200);
  expect
    .soft(
      all
        .map((row) => ({ id: row.id, result: row.result }))
        .toSorted((left, right) => left.id.localeCompare(right.id)),
      "two records, both skipped",
    )
    .toEqual([
      { id: "evt_skip_1", result: "skipped" },
      { id: "evt_skip_2", result: "skipped" },
    ]);
});

test("an-event-for-an-unknown-customer-moves-no-workspace", async ({
  journey,
}) => {
  const events: StripeEvent[] = [
    {
      type: "customer.updated",
      id: "evt_cu_1",
      object: { id: "cus_nobody", email: "x@verify.local" },
    },
    {
      type: "customer.subscription.deleted",
      id: "evt_sd_1",
      object: {
        id: "sub_nobody",
        customer: "cus_nobody",
        status: "canceled",
        items: { data: [] },
      },
    },
    {
      type: "customer.subscription.trial_will_end",
      id: "evt_tw_1",
      object: {
        id: "sub_nobody",
        customer: "cus_nobody",
        status: "trialing",
        items: { data: [] },
      },
    },
  ];
  const answers: number[] = [];
  for (const event of events) {
    answers.push((await deliverEvent(journey, event)).status);
  }
  const rows = await admitted(journey);
  expect
    .soft(answers, "every delivery is acknowledged")
    .toEqual([200, 200, 200]);
  expect
    .soft(rows.map((row) => row.id).toSorted(), "one record per event")
    .toEqual(events.map((event) => event.id).toSorted());
  expect
    .soft(
      rows
        .map((row) => row.result)
        .filter((result) => result !== "success" && result !== "skipped"),
      "none is pending or in reconciliation",
    )
    .toEqual([]);
});

test("a-trial-that-ends-follows-the-status-stripe-reports", async ({
  journey,
}) => {
  await createPlan(journey, "free", { order: 0 });
  const pro = await createPlan(journey, "pro", { price: 50, order: 1 });
  const cases = [
    { name: "trial-pastdue", stripe: "past_due", expected: "past_due" },
    { name: "trial-unpaid", stripe: "unpaid", expected: "past_due" },
    {
      name: "trial-expired",
      stripe: "incomplete_expired",
      expected: "past_due",
    },
    { name: "trial-active", stripe: "active", expected: "active" },
  ];
  for (const entry of cases) {
    const held = await holder(journey, entry.name, pro.id, "trialing");
    const delivered = await deliverEvent(
      journey,
      {
        type: "customer.subscription.updated",
        id: `evt_${entry.name}`,
        object: stripeSubscription(
          held.customer,
          `sub_${entry.name}`.replace(/-/g, "_"),
          entry.stripe,
        ),
      },
      { previousAttributes: { status: "trialing" } },
    );
    expect.soft(delivered.status, `${entry.stripe}: acknowledged`).toBe(200);
    expect
      .soft(
        await statusOf(journey, held.tenantId),
        `${entry.stripe}: the workspace is ${entry.expected}`,
      )
      .toBe(entry.expected);
  }

  const plain = await holder(journey, "trial-plain", pro.id, "trialing");
  const unmarked = await deliverEvent(journey, {
    type: "customer.subscription.updated",
    id: "evt_trial_plain",
    object: stripeSubscription(plain.customer, "sub_trial_plain", "past_due"),
  });
  expect
    .soft(unmarked.status, "an update without the trial marker is acknowledged")
    .toBe(200);
  expect
    .soft(
      await statusOf(journey, plain.tenantId),
      "an update that does not come from a trial changes no status",
    )
    .toBe("trialing");
});

test("a-failed-payment-moves-only-the-workspaces-that-can-fall-past-due", async ({
  journey,
}) => {
  await createPlan(journey, "free", { order: 0 });
  const pro = await createPlan(journey, "pro", { price: 50, order: 1 });
  const cases = [
    { status: "active", expected: "past_due" },
    { status: "trialing", expected: "past_due" },
    { status: "suspended", expected: "suspended" },
    { status: "cancelled", expected: "cancelled" },
  ];
  for (const entry of cases) {
    const name = `fail-${entry.status}`;
    const held = await holder(journey, name, pro.id, entry.status);
    const delivered = await deliverEvent(journey, {
      type: "invoice.payment_failed",
      id: `evt_${name}`,
      object: stripeInvoice(held.customer, `in_${name}`, "open", 5000),
    });
    expect.soft(delivered.status, `${entry.status}: acknowledged`).toBe(200);
    expect
      .soft(
        await statusOf(journey, held.tenantId),
        `${entry.status}: the workspace is ${entry.expected}`,
      )
      .toBe(entry.expected);
  }
});

test("invoice-paid-reactivates-a-workspace-only-when-no-invoice-is-left-open", async ({
  journey,
}) => {
  await createPlan(journey, "free", { order: 0 });
  const pro = await createPlan(journey, "pro", { price: 50, order: 1 });
  const held = await holder(journey, "owes-two", pro.id, "past_due");
  const first = await deliverEvent(journey, {
    type: "invoice.payment_failed",
    id: "evt_two_fail_1",
    object: stripeInvoice(held.customer, "in_two_1", "open", 3000),
  });
  const second = await deliverEvent(journey, {
    type: "invoice.payment_failed",
    id: "evt_two_fail_2",
    object: stripeInvoice(held.customer, "in_two_2", "open", 4000),
  });
  expect.soft(first.status, "the first failure is acknowledged").toBe(200);
  expect.soft(second.status, "the second failure is acknowledged").toBe(200);
  expect
    .soft(await statusOf(journey, held.tenantId), "two invoices open: past due")
    .toBe("past_due");

  const paidOne = await deliverEvent(journey, {
    type: "invoice.paid",
    id: "evt_two_paid_1",
    object: stripeInvoice(held.customer, "in_two_1", "paid", 3000),
  });
  expect.soft(paidOne.status, "the first payment is acknowledged").toBe(200);
  expect
    .soft(
      await statusOf(journey, held.tenantId),
      "one invoice paid, one still open: the workspace stays past due",
    )
    .toBe("past_due");

  const paidTwo = await deliverEvent(journey, {
    type: "invoice.paid",
    id: "evt_two_paid_2",
    object: stripeInvoice(held.customer, "in_two_2", "paid", 4000),
  });
  expect.soft(paidTwo.status, "the second payment is acknowledged").toBe(200);
  expect
    .soft(
      await statusOf(journey, held.tenantId),
      "the last open invoice paid: the workspace is active again",
    )
    .toBe("active");
});

test("a-deleted-subscription-cancels-the-workspace-billed-on-it", async ({
  journey,
}) => {
  await createPlan(journey, "free", { order: 0 });
  const pro = await createPlan(journey, "pro", { price: 50, order: 1 });
  const held = await holder(journey, "billed-owner", pro.id, "active");
  const before = await cancellationNotices(journey, "billed-owner");
  const delivered = await deliverEvent(journey, {
    type: "customer.subscription.deleted",
    id: "evt_deleted_billed",
    object: stripeSubscription(held.customer, "sub_billed_owner", "canceled"),
  });
  const row = await rowOf(journey, held.tenantId);
  const overview = await saas(
    journey,
    "the operator's view of the workspace",
    "GET",
    `/workspaces/${held.tenantId}/overview`,
  );
  const after = await cancellationNotices(journey, "billed-owner");
  const events = (await admitted(journey)).filter(
    (entry) => entry.id === "evt_deleted_billed",
  );
  expect.soft(delivered.status, "the delivery is acknowledged").toBe(200);
  expect
    .soft(events, "the delivery is recorded as success")
    .toMatchObject([{ result: "success" }]);
  expect
    .soft(
      row,
      "the subscription row reads cancelled and still holds the deleted subscription",
    )
    .toMatchObject({
      status: "cancelled",
      stripeSubscriptionId: "sub_billed_owner",
    });
  expect
    .soft(
      overview.body,
      "the operator's view reads cancelled, not complimentary",
    )
    .toMatchObject({ status: "cancelled", isComplimentary: false });
  expect
    .soft(before.answer.status, "the owner's feed answers before")
    .toBe(200);
  expect
    .soft(before.notices, "the owner's feed held no cancellation notice before")
    .toBe(0);
  expect.soft(after.answer.status, "the owner's feed answers after").toBe(200);
  expect
    .soft(after.notices, "the owner's feed holds one cancellation notice after")
    .toBe(1);
});

test("a-deleted-subscription-leaves-a-complimentary-workspace-alone", async ({
  journey,
}) => {
  const free = await createPlan(journey, "free", { order: 0 });
  const pro = await createPlan(journey, "pro", { price: 50, order: 1 });
  const visitor = await register(journey, "comp-owner", {
    workspaceName: "Comp Co",
  });
  await fixture(
    journey,
    "put the workspace on a Stripe customer with no subscription",
    "POST",
    "/subscription",
    {
      tenantId: visitor.tenantId,
      planId: pro.id,
      status: "active",
      stripeCustomerId: "cus_comp_owner",
    },
  );
  const grant = await saas(
    journey,
    "the operator grants free access",
    "POST",
    `/workspaces/${visitor.tenantId}/grant-free-access`,
    { body: { planId: free.id, freeUntil: null } },
  );
  const granted = await rowOf(journey, visitor.tenantId);
  expect.soft(grant.status, "the grant is accepted").toBe(200);
  expect
    .soft(
      granted,
      "the row reads active, complimentary, with no subscription id",
    )
    .toMatchObject({
      status: "active",
      isComplimentary: true,
      stripeSubscriptionId: null,
    });

  const delivered = await deliverEvent(journey, {
    type: "customer.subscription.deleted",
    id: "evt_deleted_comp",
    object: stripeSubscription("cus_comp_owner", "sub_comp_owner", "canceled"),
  });
  const row = await rowOf(journey, visitor.tenantId);
  const overview = await saas(
    journey,
    "the operator's view of the workspace",
    "GET",
    `/workspaces/${visitor.tenantId}/overview`,
  );
  const notices = await cancellationNotices(journey, "comp-owner");
  const events = (await admitted(journey)).filter(
    (entry) => entry.id === "evt_deleted_comp",
  );
  expect.soft(delivered.status, "the delivery is acknowledged").toBe(200);
  expect
    .soft(events, "the delivery is recorded as success")
    .toMatchObject([{ result: "success" }]);
  expect
    .soft(row, "the subscription row still reads active and complimentary")
    .toMatchObject({
      status: "active",
      isComplimentary: true,
      stripeSubscriptionId: null,
    });
  expect
    .soft(
      overview.body,
      "the operator's view still reads complimentary (free) with no Stripe subscription",
    )
    .toMatchObject({
      status: "free",
      isComplimentary: true,
      hasStripeSubscription: false,
    });
  expect.soft(notices.answer.status, "the owner's feed answers").toBe(200);
  expect
    .soft(notices.notices, "the owner's feed holds no cancellation notice")
    .toBe(0);
});

test("a-redelivered-handled-event-is-applied-once", async ({ journey }) => {
  await createPlan(journey, "free", { order: 0 });
  const pro = await createPlan(journey, "pro", { price: 50, order: 1 });
  const held = await holder(journey, "redelivered", pro.id, "active");
  const event: StripeEvent = {
    type: "invoice.payment_failed",
    id: "evt_redelivered_1",
    object: stripeInvoice(held.customer, "in_redelivered", "open", 5000),
  };
  const once = await deliverEvent(journey, event);
  const { pastDueSince: since } = await rowOf(journey, held.tenantId);
  await sleep(1500);
  const twice = await deliverEvent(journey, event);
  const state = await rowOf(journey, held.tenantId);
  const records = (await admitted(journey)).filter(
    (row) => row.id === "evt_redelivered_1",
  );
  expect.soft(once.status, "the first delivery is acknowledged").toBe(200);
  expect.soft(twice.status, "the redelivery is acknowledged").toBe(200);
  expect.soft(since, "past due after the first delivery").toEqual(ANY_STRING);
  expect.soft(state.status, "past due after the redelivery").toBe("past_due");
  expect.soft(state.pastDueSince, "the past-due date did not move").toBe(since);
  expect
    .soft(records, "one admission record, settled as success")
    .toMatchObject([{ result: "success" }]);
});
