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
const TEST_MODE_MARKER = "_test_";
const STRIPE_DASHBOARD_URL = "https://dashboard.stripe.com";
const TEST_MODE_DASHBOARD_PATH = "/test";

let stripeClient: Stripe | null = null;
let stripeWebhookSecret: string | null = null;
let stripeConfigured = false;
let stripeTestMode = false;

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
  stripeTestMode = config.secretKey.includes(TEST_MODE_MARKER);
}

/**
 * A page of the Stripe Dashboard for the account the module talks to, in test
 * mode when the configured key is a test key.
 *
 * @param path Dashboard path, e.g. `/invoices/in_123` (the leading slash is optional)
 */
export function stripeDashboardUrl(path: string): string {
  const mode = stripeTestMode ? TEST_MODE_DASHBOARD_PATH : "";
  const separator = path.startsWith("/") ? "" : "/";
  return `${STRIPE_DASHBOARD_URL}${mode}${separator}${path}`;
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

export function getStripeWebhookSecret(): string {
  if (!stripeWebhookSecret) {
    throw new Error("Stripe webhook secret not initialized.");
  }
  return stripeWebhookSecret;
}
