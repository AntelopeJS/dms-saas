import type { User } from "@antelopejs/interface-dms/auth/db";
import Stripe from "stripe";
import { beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({
  isStripeConfigured: true,
  loadView: vi.fn(),
  retrieveBalance: vi.fn(),
}));

vi.mock("../src/workspaces/operator-view", () => ({
  loadWorkspaceOperatorView: harness.loadView,
}));

vi.mock("../src/stripe/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/stripe/client")>()),
  isStripeConfigured: () => harness.isStripeConfigured,
}));

vi.mock("../src/stripe/customer-balance", () => ({
  retrieveStripeCustomerBalance: harness.retrieveBalance,
}));

vi.mock("@antelopejs/interface-core/logging", () => ({
  Logging: { Error: vi.fn(), Warn: vi.fn(), Info: vi.fn(), Debug: vi.fn() },
}));

import { SaasWorkspaceDetailController } from "../src/routes/platformOwner/workspace-detail";

const OPERATOR = { _id: "op" } as User;
const TENANT_ID = "tenant-1";

const controller = new SaasWorkspaceDetailController();

beforeEach(() => {
  vi.clearAllMocks();
  harness.isStripeConfigured = true;
  harness.loadView.mockResolvedValue({
    subscription: { stripeCustomerId: "cus_1" },
    directory: { currency: "eur" },
  });
});

describe("a workspace's available credit without a usable Stripe", () => {
  it("shows nothing and asks Stripe nothing when Stripe is not configured", async () => {
    harness.isStripeConfigured = false;

    expect(await controller.availableCredit(OPERATOR, TENANT_ID)).toEqual({
      items: [],
    });
    expect(harness.retrieveBalance).not.toHaveBeenCalled();
  });

  it("answers a handled 503 when Stripe refuses the key", async () => {
    harness.retrieveBalance.mockRejectedValueOnce(
      new Stripe.errors.StripeAuthenticationError({
        message: "Invalid API Key provided: sk_test_*******lder",
        type: "authentication_error",
      }),
    );

    await expect(
      controller.availableCredit(OPERATOR, TENANT_ID),
    ).rejects.toMatchObject({
      status: 503,
      body: "saas.errors.stripe.unavailable",
    });
  });
});
