import Stripe from "stripe";
import type { DmsSaasStripeConfig } from "../types";
import { isString } from "../utils/primitive-guards";

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

/**
 * Page reads are server-rendered: past this many milliseconds the page renders
 * without Stripe's figures rather than wait for the SDK's 80 s default.
 */
export const DEFAULT_STRIPE_READ_TIMEOUT_MS = 4000;
/**
 * A timed-out read is not retried by default: a retry would double the wait,
 * and the next page view asks again anyway.
 */
export const DEFAULT_STRIPE_READ_MAX_NETWORK_RETRIES = 0;

let stripeClient: Stripe | null = null;
let stripeReadClient: Stripe | null = null;
let stripeWebhookSecret: string | null = null;
let stripeConfigured = false;
let stripeTestMode = false;

function isUsableSecretKey(key: string): boolean {
  return (
    isString(key) &&
    key.startsWith(SECRET_KEY_PREFIX) &&
    !key.includes(PLACEHOLDER_MARKER)
  );
}

/**
 * Writes keep the SDK's timeout and retries: a write cut short may still land
 * on Stripe, and its idempotent retries are what make it safe to repeat.
 */
export function initStripeClient(config: DmsSaasStripeConfig): void {
  stripeClient = new Stripe(config.secretKey, {
    apiVersion: STRIPE_API_VERSION,
  });
  stripeReadClient = new Stripe(config.secretKey, {
    apiVersion: STRIPE_API_VERSION,
    timeout: config.readTimeoutMs ?? DEFAULT_STRIPE_READ_TIMEOUT_MS,
    maxNetworkRetries:
      config.readMaxNetworkRetries ?? DEFAULT_STRIPE_READ_MAX_NETWORK_RETRIES,
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

/**
 * The client for reads a page renders (billing status, next invoice, VAT
 * check): bounded by `readTimeoutMs` and `readMaxNetworkRetries`, so a slow
 * Stripe costs a page a few seconds at most. Its callers treat a failure as
 * Stripe's figures being unavailable. Writes go through {@link getStripeClient}.
 */
export function getStripeReadClient(): Stripe {
  if (!stripeReadClient) {
    throw new Error(
      "Stripe client not initialized. Call initStripeClient first.",
    );
  }
  return stripeReadClient;
}

export function getStripeWebhookSecret(): string {
  if (!stripeWebhookSecret) {
    throw new Error("Stripe webhook secret not initialized.");
  }
  return stripeWebhookSecret;
}
