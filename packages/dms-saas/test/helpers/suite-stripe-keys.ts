import { initStripeClient } from "../../src/stripe/client";
import { recordRequests, SUITE_STRIPE_KEYS, type SuiteStripe } from "./stripe";

/** A secret key the module treats as no Stripe account at all. */
export const PLACEHOLDER_SECRET_KEY = "sk_placeholder";

/**
 * Initialises the module's Stripe clients again with `secretKey` and points
 * `stripe` at them, requests recorded as `useSuiteStripe` does: a deployment
 * with a placeholder key (see {@link PLACEHOLDER_SECRET_KEY}) is not
 * configured, and `SUITE_STRIPE_KEYS.secretKey` configures it again.
 */
export function reinitSuiteStripe(
  stripe: SuiteStripe,
  secretKey: string,
): void {
  initStripeClient({ ...SUITE_STRIPE_KEYS, secretKey });
  recordRequests(stripe);
}
