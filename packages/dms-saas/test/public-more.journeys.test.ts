import { z } from "zod";
import { NON_EMPTY_STRING } from "./helpers/asymmetric-matchers.ts";
import { expect, type Json, test } from "./journeys/journey.ts";
import { registrationAttempt, STRONG } from "./journeys/public.ts";
import {
  createPlan,
  fixture,
  passwordWith,
  register,
  saas,
  errorCode,
} from "./journeys/saas.ts";

const provisioned = z.array(
  z.object({
    tenantId: z.string().optional(),
    userId: z.string().optional(),
    extras: z.unknown(),
  }),
);
const tokenOf = z.object({ token: z.string() });
const accessTokenOf = z.object({ access_token: z.string() });

test("extras-reach-the-provisioning-listeners-within-their-limits", async ({
  journey,
}) => {
  await createPlan(journey, "free");
  const extras = { referral: "launch-week", teamSize: 4, nested: { a: ["x"] } };
  const visitor = await register(journey, "extras", { extras });
  const seen = await fixture(
    journey,
    "the recorded provisioning payloads",
    "GET",
    "/provisioned",
  );
  const mine = provisioned
    .parse(seen.body)
    .find((entry) => entry.tenantId === visitor.tenantId);
  expect.soft(visitor.answer.status, "registration answers 200").toBe(200);
  expect.soft(mine?.extras, "extras equal what was sent").toEqual(extras);
  expect.soft(mine?.userId, "userId is the new user").toBe(visitor.userId);

  const attempt = (label: string, payload: Json) =>
    registrationAttempt(journey, label, {
      email: journey.email(label.slice(0, 18)),
      password: STRONG,
      name: "Extras",
      extras: payload,
    });
  const keys = (count: number): Json =>
    Object.fromEntries(
      Array.from({ length: count }, (_, index) => [`k${index}`, 1]),
    );
  const deep = (levels: number): Json =>
    levels === 0 ? 1 : { d: deep(levels - 1) };
  const padded = (bytes: number): Json => ({
    s: "x".repeat(bytes - '{"s":""}'.length),
  });
  const tooComplex = {
    status: 400,
    code: "saas.errors.registration.extras_too_complex",
  };
  const tooLarge = {
    status: 400,
    code: "saas.errors.registration.extras_too_large",
  };
  const invalid = {
    status: 400,
    code: "saas.errors.registration.extras_invalid",
  };

  expect
    .soft(await attempt("64 keys", keys(64)), "64 keys")
    .toMatchObject({ status: 200 });
  expect
    .soft(await attempt("65 keys", keys(65)), "65 keys")
    .toEqual(tooComplex);
  expect
    .soft(await attempt("depth 4", deep(4)), "depth 4")
    .toMatchObject({ status: 200 });
  expect.soft(await attempt("depth 5", deep(5)), "depth 5").toEqual(tooComplex);
  expect
    .soft(await attempt("4096 bytes", padded(4096)), "4096 bytes")
    .toMatchObject({ status: 200 });
  expect
    .soft(await attempt("4097 bytes", padded(4097)), "4097 bytes")
    .toEqual(tooLarge);
  expect.soft(await attempt("a string", "text"), "a string").toEqual(invalid);
  expect.soft(await attempt("an array", [1]), "an array").toEqual(invalid);
  expect
    .soft(
      await attempt("a constructor key", { constructor: 1 }),
      "a constructor key",
    )
    .toEqual(invalid);
});

test("a-sign-in-without-a-workspace-is-completed", async ({ journey }) => {
  const free = await createPlan(journey, "free");
  const account = await fixture(
    journey,
    "an account without a workspace",
    "POST",
    "/account-without-workspace",
    { email: journey.email("orphan"), name: "Orphan", password: STRONG },
  );
  expect(account.body, "the fixture made an account and a token").toMatchObject(
    { token: NON_EMPTY_STRING },
  );
  const { token } = tokenOf.parse(account.body);

  const pending = await saas(
    journey,
    "describe the pending registration",
    "POST",
    "/register/pending",
    { as: "anon", body: { tenant_assignment_token: token } },
  );
  expect
    .soft(pending, "the pending registration names the identity")
    .toMatchObject({
      status: 200,
      body: { email: journey.email("orphan"), name: "Orphan" },
    });

  const bad = await saas(
    journey,
    "finalize with a bad token",
    "POST",
    "/register/finalize",
    { as: "anon", body: { tenant_assignment_token: "not-a-token" } },
  );
  expect
    .soft(bad.status, "a bad token is refused with a 4xx")
    .toBeGreaterThanOrEqual(400);
  expect
    .soft(bad.status, "a bad token is refused with a 4xx")
    .toBeLessThan(500);

  const done = await saas(journey, "finalize", "POST", "/register/finalize", {
    as: "anon",
    body: { tenant_assignment_token: token, workspaceName: "Orphan HQ" },
  });
  expect
    .soft(
      done,
      "finalize opens a workspace and answers a session for the account",
    )
    .toMatchObject({
      status: 200,
      body: {
        access_token: NON_EMPTY_STRING,
        refresh_token: NON_EMPTY_STRING,
        user: { email: journey.email("orphan") },
      },
    });

  const { access_token: access } = accessTokenOf.parse(done.body);
  journey.state.tokens = { ...journey.state.tokens, orphan: access };
  const plan = await saas(
    journey,
    "the new workspace's plan",
    "GET",
    "/tenant/plan",
    { as: "orphan" },
  );
  const current = await saas(
    journey,
    "the new workspace",
    "GET",
    "/workspaces/current",
    { as: "orphan" },
  );
  expect
    .soft(plan.body, "the session reads a workspace on the free plan")
    .toMatchObject({ current: { _id: free.id } });
  expect
    .soft(current.body, "the workspace is named Orphan HQ")
    .toMatchObject({ name: "Orphan HQ" });

  const twice = await saas(
    journey,
    "finalize again",
    "POST",
    "/register/finalize",
    { as: "anon", body: { tenant_assignment_token: token } },
  );
  expect
    .soft(
      { status: twice.status, code: errorCode(twice) },
      "an account with a workspace cannot finalize again",
    )
    .toEqual({ status: 400, code: "saas.errors.user.already_has_workspace" });
});

test("the-pricing-catalogue-lists-public-plans-in-order", async ({
  journey,
}) => {
  const empty = await saas(journey, "pricing with no plan", "GET", "/pricing", {
    as: "anon",
  });
  expect
    .soft(empty.body, "an empty catalogue lists nothing and names no default")
    .toMatchObject({ plans: [], defaultPlanId: null });

  const pro = await createPlan(journey, "pro", {
    price: 20,
    order: 2,
    name: { en: "Pro" },
  });
  const free = await createPlan(journey, "free", {
    order: 1,
    name: { en: "Free" },
  });
  const secret = await createPlan(journey, "secret", {
    order: 0,
    isPublic: false,
    name: { en: "Secret" },
  });
  await createPlan(journey, "retired", {
    order: 0,
    isActive: false,
    name: { en: "Retired" },
  });
  const hidden = await saas(
    journey,
    "pricing while the default plan is hidden",
    "GET",
    "/pricing",
    { as: "anon" },
  );
  const hiddenPlan = await saas(
    journey,
    "the registration plan while the default plan is hidden",
    "GET",
    "/register/plan",
    { as: "anon" },
  );
  expect
    .soft(
      hidden.body,
      "a default plan that is not on sale is not named by pricing",
    )
    .toMatchObject({ defaultPlanId: null });
  expect
    .soft(hiddenPlan.body, "sign-up opens on the hidden lowest-order free plan")
    .toMatchObject({ plan: { _id: secret.id } });

  const moved = await saas(
    journey,
    "move the hidden plan after the free plan",
    "PUT",
    `/plans/${secret.id}`,
    { body: { order: 9 } },
  );
  expect(moved.status, "PUT answers 200").toBe(200);

  const pricing = await saas(journey, "pricing", "GET", "/pricing", {
    as: "anon",
  });
  expect
    .soft(pricing.body, "only active public plans, by order: free then pro")
    .toMatchObject({
      plans: [{ slug: "free" }, { slug: "pro", price: 20, currency: "EUR" }],
    });
  expect
    .soft(pricing.body, "the default plan is the free plan")
    .toMatchObject({ defaultPlanId: free.id });

  const plan = await saas(
    journey,
    "the registration plan",
    "GET",
    "/register/plan",
    { as: "anon" },
  );
  const chosen = await saas(
    journey,
    "the registration plan with a chosen plan",
    "GET",
    `/register/plan?plan=${pro.id}`,
    { as: "anon" },
  );
  expect
    .soft(plan.body, "the workspace opens on the free plan")
    .toMatchObject({ plan: { _id: free.id }, requestedPlan: null });
  expect.soft(chosen.body, "the chosen plan is named").toMatchObject({
    requestedPlan: { _id: pro.id },
    plan: { _id: free.id },
  });
});

test("a-listener-that-throws-cancels-the-registration", async ({ journey }) => {
  await createPlan(journey, "free");
  const email = journey.email("rolledback");
  const password = passwordWith();
  const failed = await saas(
    journey,
    "register with a listener that refuses",
    "POST",
    "/register",
    {
      as: "anon",
      body: {
        email,
        password,
        name: "Rolled Back",
        extras: { verifyFailProvisioning: true },
      },
    },
  );
  const again = await saas(
    journey,
    "register the same address without the trigger",
    "POST",
    "/register",
    { as: "anon", body: { email, password, name: "Rolled Back" } },
  );
  expect
    .soft(failed.status, "the first registration fails")
    .toBeGreaterThanOrEqual(400);
  expect.soft(again.status, "the same address registers afterwards").toBe(200);
});
