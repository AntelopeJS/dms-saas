import Stripe from "stripe";
import type { DmsSaasStripeConfig } from "../types";

const STRIPE_API_VERSION = "2024-11-20.acacia" as const;
const SECRET_KEY_PREFIX = "sk_";
const PLACEHOLDER_MARKER = "placeholder";

let stripeClient: Stripe | null = null;
let stripeWebhookSecret: string | null = null;
let stripeConfigured = false;

function isUsableSecretKey(key: string): boolean {
  return (
    typeof key === "string" &&
    key.startsWith(SECRET_KEY_PREFIX) &&
    !key.includes(PLACEHOLDER_MARKER)
  );
}

export function initStripeClient(config: DmsSaasStripeConfig): void {
  stripeClient = new Stripe(config.secretKey, {
    apiVersion: STRIPE_API_VERSION as Stripe.LatestApiVersion,
  });
  stripeWebhookSecret = config.webhookSecret;
  stripeConfigured = isUsableSecretKey(config.secretKey);
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
