import Stripe from "stripe";
import type { DmsSaasStripeConfig } from "../types";

/**
 * The Stripe API version every request is made with. It must be the version
 * the installed SDK is generated for — the type below breaks the build when
 * they drift apart. Webhook endpoints render their events in their own API
 * version, set in the Stripe Dashboard; they should be moved to this one (see
 * payload-shapes.ts for the older shapes still accepted meanwhile).
 */
export const STRIPE_API_VERSION: Stripe.LatestApiVersion = "2026-08-26.dahlia";

const SECRET_KEY_PREFIX = "sk_";
const PLACEHOLDER_MARKER = "placeholder";

let stripeClient: Stripe | null = null;
let stripeWebhookSecret: string | null = null;
let stripeConfigured = false;
let stripeTestMode = false;

const TEST_SECRET_KEY_PREFIX = "sk_test_";
const STRIPE_DASHBOARD_URL = "https://dashboard.stripe.com";
const STRIPE_DASHBOARD_TEST_PATH = "/test";

function isUsableSecretKey(key: string): boolean {
  return (
    typeof key === "string" &&
    key.startsWith(SECRET_KEY_PREFIX) &&
    !key.includes(PLACEHOLDER_MARKER)
  );
}

export function initStripeClient(config: DmsSaasStripeConfig): void {
  stripeClient = new Stripe(config.secretKey, {
    apiVersion: STRIPE_API_VERSION,
  });
  stripeWebhookSecret = config.webhookSecret;
  stripeConfigured = isUsableSecretKey(config.secretKey);
  stripeTestMode = config.secretKey.startsWith(TEST_SECRET_KEY_PREFIX);
}

export function isStripeConfigured(): boolean {
  return stripeConfigured;
}

export function getStripeClient(): Stripe {
  if (!stripeClient) {
    throw new Error(
      "Stripe client not initialized. Call initStripeClient first.",
    );
  }
  return stripeClient;
}

/**
 * Link to a Stripe object in the Stripe Dashboard, in the mode (test or
 * live) of the configured key: `stripeDashboardUrl("products/prod_1")`.
 *
 * @param path Dashboard path of the object, without a leading slash
 */
export function stripeDashboardUrl(path: string): string {
  const mode = stripeTestMode ? STRIPE_DASHBOARD_TEST_PATH : "";
  return `${STRIPE_DASHBOARD_URL}${mode}/${path}`;
}

export function getStripeWebhookSecret(): string {
  if (!stripeWebhookSecret) {
    throw new Error("Stripe webhook secret not initialized.");
  }
  return stripeWebhookSecret;
}
