import { randomUUID } from "node:crypto";
import { GetModel } from "@antelopejs/interface-database-decorators";
import type { User } from "@antelopejs/interface-dms/auth/db";
import { TenantModel } from "@antelopejs/interface-dms/db";
import { fromPartial } from "@total-typescript/shoehorn";
import Stripe from "stripe";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TenantSubscriptionModel } from "../src/db";
import { SaasWorkspaceDetailController } from "../src/routes/platformOwner/workspace-detail";
import { getStripeClient, initStripeClient } from "../src/stripe/client";
import { useMongoDatabase } from "./helpers/mongo";
import { SUITE_STRIPE_KEYS, useSuiteStripe } from "./helpers/stripe";

useMongoDatabase("workspace-available-credit");
const stripe = useSuiteStripe();

const OPERATOR = fromPartial<User>({ _id: "op" });
/** A key of the shape a deployment leaves in its sample configuration. */
const PLACEHOLDER_SECRET_KEY = "sk_test_placeholder";

const controller = new SaasWorkspaceDetailController();

/** The workspace of the current test, billed to a Stripe customer. */
let tenantId = "";

beforeEach(async () => {
  tenantId = randomUUID();
  const now = new Date();
  await GetModel(TenantModel).insert({
    _id: tenantId,
    name: "Workspace",
    createdAt: now,
    updatedAt: now,
  });
  await GetModel(TenantSubscriptionModel, tenantId).insert({
    _id: tenantId,
    status: "active",
    stripeCustomerId: "cus_1",
  });
});

afterEach(() => {
  initStripeClient(SUITE_STRIPE_KEYS);
});

describe("a workspace's available credit without a usable Stripe", () => {
  it("shows nothing and asks Stripe nothing when Stripe is not configured", async () => {
    initStripeClient({
      ...SUITE_STRIPE_KEYS,
      secretKey: PLACEHOLDER_SECRET_KEY,
    });
    const retrieve = vi.spyOn(getStripeClient().customers, "retrieve");

    expect(await controller.availableCredit(OPERATOR, tenantId)).toEqual({
      items: [],
    });
    expect(retrieve).not.toHaveBeenCalled();
  });

  it("answers a handled 503 when Stripe refuses the key", async () => {
    vi.spyOn(stripe.write.customers, "retrieve").mockRejectedValueOnce(
      new Stripe.errors.StripeAuthenticationError({
        message: "Invalid API Key provided: sk_test_*******lder",
        type: "authentication_error",
      }),
    );

    await expect(
      controller.availableCredit(OPERATOR, tenantId),
    ).rejects.toMatchObject({
      status: 503,
      body: "saas.errors.stripe.unavailable",
    });
  });
});
