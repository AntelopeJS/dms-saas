import { GetModel } from "@antelopejs/interface-database-decorators";
import {
  authenticateRequestUser,
  generateTenantAssignmentToken,
} from "@antelopejs/interface-dms/auth";
import type { User } from "@antelopejs/interface-dms/auth/db";
import { resolveRequestTenantId } from "@antelopejs/interface-dms/request-tenant";
import Stripe from "stripe";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getRegistrationPaymentMethodPolicy,
  setRuntimeConfig,
} from "../src/config";
import { type TenantSubscription, TenantSubscriptionModel } from "../src/db";
import { getStripeClient } from "../src/stripe/client";
import type { DmsSaasConfig } from "../src/types";
import { createUser, useDmsAuth } from "./helpers/dms";
import { useMongoDatabase } from "./helpers/mongo";
import {
  bearer,
  buildController,
  buildRegisterBody,
  onTenantInserted,
  PAID_PLAN,
  PLAN,
  serveStripe,
  useRegistrationWorld,
  world,
} from "./helpers/registration";
import { SUITE_STRIPE_KEYS, useSuiteStripe } from "./helpers/stripe";
import { withUnconfiguredStripe } from "./helpers/unconfigured-stripe";
import { ANY_STRING } from "./helpers/asymmetric-matchers";

useMongoDatabase("registration-card-policy");
const suiteStripe = useSuiteStripe();
const stripe = useRegistrationWorld();
useDmsAuth();

describe("registration card policy", () => {
  function applyPolicy(
    paymentMethod: NonNullable<DmsSaasConfig["registration"]>["paymentMethod"],
  ): void {
    setRuntimeConfig({
      stripe: SUITE_STRIPE_KEYS,
      registration: { paymentMethod },
    });
  }

  function cardlessBody() {
    const { paymentMethodId: _card, ...body } = buildRegisterBody();
    return body;
  }

  afterEach(() => {
    setRuntimeConfig({ stripe: SUITE_STRIPE_KEYS });
  });

  it("defaults to requiring a card, as before the option existed", async () => {
    setRuntimeConfig({ stripe: SUITE_STRIPE_KEYS });

    await expect(
      buildController().register(cardlessBody()),
    ).rejects.toMatchObject({
      status: 400,
      body: "saas.errors.registration.payment_method_required",
    });
    expect(await world.users()).toEqual([]);
  });

  it("provisions through Stripe on the free plan when a card is required", async () => {
    applyPolicy("required");

    const result = await buildController().register(buildRegisterBody());

    expect(stripe.customers.size).toBe(1);
    expect(await world.subscriptionOf(result.tenantId)).toMatchObject({
      planId: PLAN._id,
      cardFingerprint: "fp_test",
    });
  });

  it("refuses a card that already backs as many free workspaces as allowed", async () => {
    applyPolicy("required");
    await world.capFreeWorkspacesPerCard();
    await buildController().register(buildRegisterBody());

    await expect(
      buildController().register(buildRegisterBody()),
    ).rejects.toMatchObject({
      status: 409,
      body: "saas.errors.workspace.free_card_limit_reached",
    });
    expect(await world.users()).toHaveLength(1);
    expect(stripe.customers.size).toBe(1);
  });

  it("opens a paid plan chosen on Pricing awaiting its first payment instead", async () => {
    applyPolicy("required");
    await world.capFreeWorkspacesPerCard();
    await buildController().register(buildRegisterBody());

    const result = await buildController().register(
      buildRegisterBody({ requestedPlanId: PAID_PLAN._id }),
    );

    expect(await world.subscriptionOf(result.tenantId)).toMatchObject({
      planId: PAID_PLAN._id,
      status: "pending_payment",
      stripeCustomerId: null,
      stripeSubscriptionId: null,
      cardFingerprint: null,
    });
    expect(stripe.customers.size).toBe(1);
    expect(await world.users()).toHaveLength(2);
  });

  it("still refuses the card when the plan chosen on Pricing is free", async () => {
    applyPolicy("required");
    await world.capFreeWorkspacesPerCard();
    await buildController().register(buildRegisterBody());

    await expect(
      buildController().register(
        buildRegisterBody({ requestedPlanId: PLAN._id }),
      ),
    ).rejects.toMatchObject({
      status: 409,
      body: "saas.errors.workspace.free_card_limit_reached",
    });
  });

  it("never calls Stripe under `none`, even when a card is sent", async () => {
    applyPolicy("none");
    const retrieve = vi.spyOn(getStripeClient().paymentMethods, "retrieve");

    const result = await buildController().register(buildRegisterBody());

    expect(retrieve).not.toHaveBeenCalled();
    expect(stripe.customers.size).toBe(0);
    expect(stripe.liveSubscriptions.size).toBe(0);
    expect(await world.subscriptionOf(result.tenantId)).toMatchObject({
      planId: PLAN._id,
      status: "active",
      stripeCustomerId: null,
      stripeSubscriptionId: null,
      cardFingerprint: null,
    });
    expect(
      (await world.deliveries()).every((row) => row.status === "succeeded"),
    ).toBe(true);
  });

  it("replaces a default row the backfill wrote under the tenant key", async () => {
    applyPolicy("required");
    const backfills: TenantSubscription[] = [];
    onTenantInserted(async (tenantId) => {
      const model = GetModel(TenantSubscriptionModel, tenantId);
      await model.insert({
        _id: tenantId,
        planId: "plan_default",
        status: "active",
        isComplimentary: false,
        paidUsagePeriods: [],
        stripeCustomerId: null,
        stripeSubscriptionId: null,
        createdBy: null,
      });
      backfills.push(...(await model.getAll()));
    });

    const result = await buildController().register(buildRegisterBody());

    const paid = await world.subscriptionOf(result.tenantId);
    expect(paid).toMatchObject({
      _id: result.tenantId,
      planId: PLAN._id,
      cardFingerprint: "fp_test",
      stripeCustomerId: ANY_STRING,
      stripeSubscriptionId: ANY_STRING,
      createdAt: backfills[0]?.createdAt,
    });
    expect(backfills).toEqual([
      expect.objectContaining({ _id: result.tenantId, planId: "plan_default" }),
    ]);
    expect(paid?.paidUsagePeriods).toEqual([
      expect.objectContaining({
        stripeSubscriptionId: paid?.stripeSubscriptionId,
        end: null,
      }),
    ]);
    expect(await world.subscriptions()).toHaveLength(1);
    expect(stripe.paidInvoices.size).toBe(1);
  });

  it("lets the visitor skip the card under `optional`", async () => {
    applyPolicy("optional");

    const result = await buildController().register(cardlessBody());

    expect(stripe.customers.size).toBe(0);
    expect(await world.subscriptionOf(result.tenantId)).toMatchObject({
      stripeCustomerId: null,
      stripeSubscriptionId: null,
    });
  });

  it("still takes a card offered under `optional`", async () => {
    applyPolicy("optional");

    const result = await buildController().register(buildRegisterBody());

    expect(stripe.customers.size).toBe(1);
    expect(
      (await world.subscriptionOf(result.tenantId))?.stripeSubscriptionId,
    ).toBeTruthy();
  });

  it("opens a card-less workspace from the OAuth entry too", async () => {
    applyPolicy("none");
    const oauthUser: User = await createUser({
      email: "oauth@example.com",
      name: "O",
    });
    const { token } = await generateTenantAssignmentToken(oauthUser);
    const { email: _email, password: _password, ...body } = cardlessBody();

    const response = await buildController().finalize({
      ...body,
      tenant_assignment_token: token,
    });

    const [tenant] = await world.tenants();
    const request = bearer(response.access_token);
    await expect(authenticateRequestUser(request)).resolves.toMatchObject({
      _id: oauthUser._id,
    });
    await expect(resolveRequestTenantId(request)).resolves.toBe(tenant?._id);
    expect(stripe.customers.size).toBe(0);
  });

  it("names the workspace by default when the screen sent no name", async () => {
    applyPolicy("none");
    const { workspaceName: _name, ...body } = cardlessBody();

    const result = await buildController().register(body);

    expect(await world.tenants()).toEqual([
      expect.objectContaining({ _id: result.tenantId, name: "My workspace" }),
    ]);
  });

  it("refuses to sign up when the catalogue has no free plan", async () => {
    applyPolicy("none");
    await world.updatePlan(PLAN._id, { price: 20 });

    await expect(
      buildController().register(cardlessBody()),
    ).rejects.toMatchObject({
      status: 409,
      body: "saas.errors.plan.no_free_plan",
    });
    expect(await world.users()).toEqual([]);
  });

  it("restricts the registration SetupIntent to cards through the allow-list", async () => {
    applyPolicy("required");
    const create = vi.spyOn(getStripeClient().setupIntents, "create");

    await expect(buildController().createSetupIntent()).resolves.toEqual({
      clientSecret: "seti_secret",
    });
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ allowed_payment_method_types: ["card"] }),
    );
    expect(create.mock.calls[0]?.[0]).not.toHaveProperty(
      "payment_method_types",
    );
  });

  it("offers no SetupIntent when the deployment takes no card", async () => {
    applyPolicy("none");
    const create = vi.spyOn(getStripeClient().setupIntents, "create");

    await expect(buildController().createSetupIntent()).rejects.toMatchObject({
      status: 400,
      body: "saas.errors.registration.payment_method_disabled",
    });
    expect(create).not.toHaveBeenCalled();
  });

  it("registers on the free plan without a card while Stripe is not configured", async () => {
    applyPolicy("required");
    await withUnconfiguredStripe(suiteStripe, async ({ write }) => {
      serveStripe(stripe);
      const retrieve = vi.spyOn(write.paymentMethods, "retrieve");

      const result = await buildController().register(cardlessBody());

      expect(getRegistrationPaymentMethodPolicy()).toBe("none");
      expect(retrieve).not.toHaveBeenCalled();
      expect(stripe.customers.size).toBe(0);
      expect(await world.subscriptionOf(result.tenantId)).toMatchObject({
        planId: PLAN._id,
        stripeCustomerId: null,
      });
    });
  });

  it("answers a handled 503 when Stripe refuses the key for a SetupIntent", async () => {
    applyPolicy("required");
    vi.spyOn(getStripeClient().setupIntents, "create").mockRejectedValueOnce(
      new Stripe.errors.StripeAuthenticationError({
        message: "Invalid API Key provided: sk_test_*******lder",
        type: "authentication_error",
      }),
    );

    await expect(buildController().createSetupIntent()).rejects.toMatchObject({
      status: 503,
      body: "saas.errors.stripe.unavailable",
    });
  });

  it("answers a handled 503 when registration reaches Stripe and it is down", async () => {
    applyPolicy("required");
    vi.spyOn(
      getStripeClient().paymentMethods,
      "retrieve",
    ).mockRejectedValueOnce(
      new Stripe.errors.StripeConnectionError({
        message: "An error occurred with our connection to Stripe.",
        type: "api_error",
      }),
    );

    await expect(
      buildController().register(buildRegisterBody()),
    ).rejects.toMatchObject({
      status: 503,
      body: "saas.errors.stripe.unavailable",
    });
    expect(await world.users()).toEqual([]);
  });

  it("rejects an unknown policy at configuration time", () => {
    expect(() =>
      setRuntimeConfig({
        stripe: SUITE_STRIPE_KEYS,
        // @ts-expect-error "sometimes" is off-contract for registration.paymentMethod; the runtime config must refuse it at configuration time
        registration: { paymentMethod: "sometimes" },
      }),
    ).toThrow("Invalid dms-saas registration.paymentMethod");
  });
});
