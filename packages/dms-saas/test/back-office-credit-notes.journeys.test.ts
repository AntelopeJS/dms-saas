import { expect, type JsonObject, test } from "./journeys/journey.ts";
import { errorCode } from "./journeys/back-office.ts";
import { createPlan, register, saas } from "./journeys/saas.ts";

test("a-credit-note-request-is-validated-before-stripe-is-asked", async ({
  journey,
}) => {
  const valid = {
    invoiceId: "in_none",
    amount: 100,
    mode: "credit_to_balance",
    reason: "goodwill",
    requestId: "req-valid-1",
  };
  const attempt = (label: string, body: JsonObject) =>
    saas(journey, label, "POST", "/credit-notes/issue", { body });
  const malformed = [
    { label: "no reason", body: { ...valid, reason: undefined } },
    { label: "an unknown reason", body: { ...valid, reason: "because" } },
    { label: "a fractional amount", body: { ...valid, amount: 10.5 } },
    { label: "a negative amount", body: { ...valid, amount: -5 } },
    { label: "no request id", body: { ...valid, requestId: undefined } },
    { label: "an empty invoice id", body: { ...valid, invoiceId: "" } },
    {
      label: "a request id of 101 characters",
      body: { ...valid, requestId: "r".repeat(101) },
    },
    { label: "an unknown mode", body: { ...valid, mode: "cash" } },
  ];
  for (const { label, body } of malformed) {
    const answer = await saas(
      journey,
      `credit note with ${label}`,
      "POST",
      "/credit-notes/issue",
      { body },
    );
    expect.soft(answer.status, `${label}: 400`).toBe(400);
  }

  for (const reason of [
    "service_issue",
    "billing_error",
    "duplicate",
    "goodwill",
    "fraudulent",
    "other",
  ]) {
    const answer = await attempt(`credit note for ${reason}`, {
      ...valid,
      reason,
      requestId: `req-${reason}`,
    });
    expect
      .soft(
        { status: answer.status, code: errorCode(answer) },
        `${reason}: passes validation, then 503 saas.errors.stripe.not_configured`,
      )
      .toEqual({ status: 503, code: "saas.errors.stripe.not_configured" });
  }
  for (const mode of ["credit_to_balance", "refund", "reduce_amount_due"]) {
    const answer = await attempt(`credit note in mode ${mode}`, {
      ...valid,
      mode,
      requestId: `req-${mode}`,
    });
    expect
      .soft(answer.status, `${mode}: 503 saas.errors.stripe.not_configured`)
      .toBe(503);
  }
});

test("issuing-a-credit-note-without-stripe-is-refused-before-any-call", async ({
  journey,
}) => {
  await createPlan(journey, "free");
  await register(journey, "payer");
  const request = (requestId: string, fields: JsonObject) => ({
    invoiceId: "in_none",
    amount: 100,
    mode: "credit_to_balance",
    reason: "goodwill",
    requestId,
    ...fields,
  });

  const preview = await saas(
    journey,
    "preview a credit note",
    "GET",
    "/credit-notes/preview/in_none",
  );
  const issue = await saas(
    journey,
    "issue a credit note",
    "POST",
    "/credit-notes/issue",
    {
      body: request("req-credit-1", {}),
    },
  );
  for (const [label, answer] of [
    ["preview", preview],
    ["issue", issue],
  ] as const) {
    expect
      .soft(
        { status: answer.status, code: errorCode(answer) },
        `${label}: 503 saas.errors.stripe.not_configured`,
      )
      .toEqual({ status: 503, code: "saas.errors.stripe.not_configured" });
  }

  const bad = await saas(
    journey,
    "issue with an amount of zero",
    "POST",
    "/credit-notes/issue",
    { body: request("req-credit-2", { amount: 0 }) },
  );
  const mode = await saas(
    journey,
    "issue with an unknown mode",
    "POST",
    "/credit-notes/issue",
    { body: request("req-credit-3", { mode: "cash" }) },
  );
  const memo = await saas(
    journey,
    "issue with a very long memo",
    "POST",
    "/credit-notes/issue",
    { body: request("req-credit-4", { memo: "m".repeat(5000) }) },
  );
  expect.soft(bad.status, "amount 0: 400").toBe(400);
  expect
    .soft(JSON.stringify(bad.body), "amount 0 names its rule")
    .toContain("$saas.errors.credit_note.amount_positive");
  expect.soft(mode.status, "unknown mode: 400").toBe(400);
  expect.soft(memo.status, "memo over the limit: 400").toBe(400);
  expect
    .soft(JSON.stringify(memo.body), "the memo names its rule")
    .toContain("$saas.errors.credit_note.memo_too_long");

  const owner = await saas(
    journey,
    "a workspace owner previews",
    "GET",
    "/credit-notes/preview/in_none",
    { as: "payer" },
  );
  const anon = await saas(
    journey,
    "an anonymous caller issues",
    "POST",
    "/credit-notes/issue",
    { as: "anon", body: request("req-credit-5", {}) },
  );
  expect
    .soft([401, 403], "a workspace owner: 401 or 403")
    .toContain(owner.status);
  expect.soft([401, 403], "anonymous: 401 or 403").toContain(anon.status);
});
