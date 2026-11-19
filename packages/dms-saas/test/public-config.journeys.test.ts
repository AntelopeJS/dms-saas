import { z } from "zod";
import { expect, test } from "./journeys/journey.ts";
import { planRegistrationOpensOn } from "./journeys/public.ts";
import {
  createPlan,
  page,
  refusedAtStart,
  saas,
  withConfig,
} from "./journeys/saas.ts";

const workspaceListing = z.array(z.object({ planName: z.string().nullish() }));

test("a-wrong-option-stops-the-module-at-start", async ({ journey }) => {
  const admission = await refusedAtStart(journey, {
    VERIFY_SAAS_ADMISSION: "closed",
  });
  const method = await refusedAtStart(journey, {
    VERIFY_SAAS_PAYMENT_METHOD: "sometimes",
  });
  const negative = await refusedAtStart(journey, {
    VERIFY_SAAS_PREVIEW_TTL: "-1",
  });
  expect
    .soft(admission, "admissionMode other than open and invitation-only")
    .toMatchObject({ started: false });
  expect
    .soft(
      method,
      "registration.paymentMethod other than required, optional and none",
    )
    .toMatchObject({ started: false });
  expect
    .soft(negative, "a negative upcomingInvoicePreviewCacheTtlSeconds")
    .toMatchObject({ started: false });

  const zero = await refusedAtStart(journey, { VERIFY_SAAS_PREVIEW_TTL: "0" });
  const open = await refusedAtStart(journey, { VERIFY_SAAS_ADMISSION: "open" });
  const invitation = await refusedAtStart(journey, {
    VERIFY_SAAS_ADMISSION: "invitation-only",
    VERIFY_SAAS_PAYMENT_METHOD: "optional",
  });
  expect
    .soft(zero, "a lifetime of 0 (price every request) starts")
    .toMatchObject({ started: true });
  expect.soft(open, "open starts").toMatchObject({ started: true });
  expect
    .soft(invitation, "invitation-only with optional starts")
    .toMatchObject({ started: true });
});

test("a-default-plan-slug-picks-among-the-free-plans", async ({ journey }) => {
  const unattached = await saas(
    journey,
    "the admin's workspace before any plan",
    "GET",
    "/workspaces/mine",
  );
  const first = await createPlan(journey, "first", { order: 0 });
  const attached = await saas(
    journey,
    "the admin's workspace once the first free plan is published",
    "GET",
    "/workspaces/mine",
  );
  expect
    .soft(
      workspaceListing.parse(unattached.body)[0]?.planName ?? "",
      "before: no plan",
    )
    .toBe("");
  expect
    .soft(attached.body, "after: the first free plan")
    .toMatchObject([{ planName: "first" }]);

  const second = await createPlan(journey, "second", { order: 1 });
  await createPlan(journey, "paid", { order: 2, price: 10 });
  const unset = await planRegistrationOpensOn(
    journey,
    "the plan without defaultPlanSlug",
  );
  let picked = "";
  await withConfig(
    journey,
    { VERIFY_SAAS_DEFAULT_PLAN: "second" },
    async () => {
      picked = await planRegistrationOpensOn(
        journey,
        "the plan with defaultPlanSlug second",
      );
    },
  );
  expect
    .soft(picked, "a slug naming a free plan picks it, not the lowest order")
    .toBe(second.id);
  let ghost = "";
  await withConfig(journey, { VERIFY_SAAS_DEFAULT_PLAN: "ghost" }, async () => {
    ghost = await planRegistrationOpensOn(
      journey,
      "the plan with a slug naming nothing",
    );
  });
  expect
    .soft(ghost, "a slug naming no plan gives the lowest-ordered free plan")
    .toBe(first.id);
  let paid = "";
  await withConfig(journey, { VERIFY_SAAS_DEFAULT_PLAN: "paid" }, async () => {
    paid = await planRegistrationOpensOn(
      journey,
      "the plan with a slug naming a paid plan",
    );
  });
  expect
    .soft(
      paid,
      "a paid plan cannot be the default: the lowest-ordered free plan",
    )
    .toBe(first.id);
  expect.soft(unset, "without the option the lowest order wins").toBe(first.id);
});

test("a-screen-switched-off-frees-its-slug", async ({ journey }) => {
  await createPlan(journey, "free");
  const REGISTER = /<title>Create your account/;
  const PRICING = /<title>Pricing/;
  expect
    .soft(
      (await page(journey, "/register")).html,
      "by default /register is served",
    )
    .toMatch(REGISTER);
  expect
    .soft(
      (await page(journey, "/pricing")).html,
      "by default /pricing is served",
    )
    .toMatch(PRICING);

  await withConfig(
    journey,
    { VERIFY_SAAS_SCREENS_OFF: "register" },
    async () => {
      expect
        .soft(
          (await page(journey, "/register")).html,
          "register off: /register is not the module's page",
        )
        .not.toMatch(REGISTER);
      expect
        .soft(
          (await page(journey, "/pricing")).html,
          "register off: /pricing is still served",
        )
        .toMatch(PRICING);
    },
  );

  await withConfig(
    journey,
    { VERIFY_SAAS_SCREENS_OFF: "pricing" },
    async () => {
      const catalogue = await saas(
        journey,
        "the pricing API while the page is off",
        "GET",
        "/pricing",
        { as: "anon" },
      );
      expect
        .soft(
          (await page(journey, "/pricing")).html,
          "pricing off: /pricing is not the module's page",
        )
        .not.toMatch(PRICING);
      expect
        .soft(
          (await page(journey, "/register")).html,
          "pricing off: /register is still served",
        )
        .toMatch(REGISTER);
      expect
        .soft(catalogue, "GET /api/saas/pricing still lists the plan")
        .toMatchObject({ status: 200, body: { plans: [{ slug: "free" }] } });
    },
  );
});

test("a-plan-saved-without-a-billing-mode-keeps-the-pricing-page-up", async ({
  journey,
}) => {
  const plan = await saas(
    journey,
    "save a plan without billingMode",
    "POST",
    "/plans",
    {
      body: {
        name: { en: "Free" },
        slug: "free",
        price: 0,
        currency: "EUR",
        interval: "month",
        audience: "any",
        isPublic: true,
        isActive: true,
        order: 0,
      },
    },
  );
  expect(plan.status, "the plan is saved").toBe(200);

  const html = (await page(journey, "/pricing")).html;
  const api = await saas(journey, "the catalogue API", "GET", "/pricing", {
    as: "anon",
  });
  expect
    .soft(api.body, "GET /api/saas/pricing lists it as a flat rate")
    .toMatchObject({ plans: [{ billingMode: "flat" }] });
  expect
    .soft(html, "the pricing page is rendered, not the server error")
    .toMatch(/<title>Pricing/);

  const tiered = await saas(
    journey,
    "save a plan with an unknown billingMode",
    "POST",
    "/plans",
    {
      body: {
        name: { en: "Tiered" },
        slug: "tiered",
        price: 5,
        currency: "EUR",
        interval: "month",
        audience: "any",
        billingMode: "tiered",
      },
    },
  );
  expect.soft(tiered, "an unknown billing mode is refused").toMatchObject({
    status: 400,
    body: "saas.errors.plan.invalid_billing_mode",
  });
});
