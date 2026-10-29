import { randomUUID } from "node:crypto";
import { GetModel } from "@antelopejs/interface-database-decorators";
import type { User } from "@antelopejs/interface-dms/auth/db";
import { TenantModel } from "@antelopejs/interface-dms/db";
import { fromPartial } from "@total-typescript/shoehorn";
import Stripe from "stripe";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TenantSubscriptionModel } from "../src/db";
import { SaasWorkspaceDetailController } from "../src/routes/platformOwner/workspace-detail";
import { useMongoDatabase } from "./helpers/mongo";
import { useSuiteStripe } from "./helpers/stripe";
import { withUnconfiguredStripe } from "./helpers/unconfigured-stripe";

useMongoDatabase("workspace-available-credit");
const stripe = useSuiteStripe();

const OPERATOR = fromPartial<User>({ _id: "op" });

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

describe("a workspace's available credit without a usable Stripe", () => {
  it("shows nothing and asks Stripe nothing when Stripe is not configured", async () => {
    await withUnconfiguredStripe(stripe, async ({ write }) => {
      const retrieve = vi.spyOn(write.customers, "retrieve");

      expect(await controller.availableCredit(OPERATOR, tenantId)).toEqual({
        items: [],
      });
      expect(retrieve).not.toHaveBeenCalled();
    });
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
