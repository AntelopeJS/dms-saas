import { initStripeClient } from "../../src/stripe/client";
import { recordRequests, SUITE_STRIPE_KEYS, type SuiteStripe } from "./stripe";

/**
 * Runs `body` with Stripe configured with a placeholder secret key, which the
 * module treats as no Stripe at all (`isStripeConfigured()` is false), then
 * puts the suite's keys back. `stripe` points at the clients the module holds
 * throughout, and keeps recording the requests they send.
 *
 * @param stripe The suite's clients, from `useSuiteStripe`
 * @param body Receives the write and read clients the module now holds, to stub calls on them
 */
export async function withUnconfiguredStripe(
  stripe: SuiteStripe,
  body: (unconfigured: Pick<SuiteStripe, "write" | "read">) => Promise<void>,
): Promise<void> {
  initStripeClient({ ...SUITE_STRIPE_KEYS, secretKey: "sk_placeholder" });
  recordRequests(stripe);
  try {
    await body({ write: stripe.write, read: stripe.read });
  } finally {
    initStripeClient(SUITE_STRIPE_KEYS);
    recordRequests(stripe);
  }
}
