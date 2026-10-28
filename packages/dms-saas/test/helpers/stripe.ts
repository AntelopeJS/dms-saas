import type Stripe from "stripe";
import { afterEach, expect, vi } from "vitest";
import {
  getStripeClient,
  getStripeReadClient,
  initStripeClient,
} from "../../src/stripe/client";

/**
 * Keys shaped like a test account's that stand for no account: `sk_test_`
 * makes the module treat Stripe as configured, and Stripe refuses any request
 * that reaches it with them.
 */
export const SUITE_STRIPE_KEYS = {
  secretKey: "sk_test_dms_saas_suite",
  webhookSecret: "whsec_dms_saas_suite",
  publishableKey: "pk_test_dms_saas_suite",
};

/** The module's own Stripe clients, built by `initStripeClient`. */
export interface SuiteStripe {
  /** What `getStripeClient` returns: the client the module writes with. */
  write: Stripe;
  /** What `getStripeReadClient` returns: the bounded client pages read with. */
  read: Stripe;
  /** `METHOD /path` of every request a client sent, in order. */
  requests: string[];
}

/**
 * Initialises the module's real Stripe clients with {@link SUITE_STRIPE_KEYS}.
 * A test stubs each Stripe call it expects with `vi.spyOn` on a resource of
 * `write` or `read`; a call left unstubbed sends a request, and the suite
 * fails after that test. Call it at the top level of a test file: spies are
 * restored after each test.
 */
export function useSuiteStripe(): SuiteStripe {
  initStripeClient(SUITE_STRIPE_KEYS);
  const stripe: SuiteStripe = {
    write: getStripeClient(),
    read: getStripeReadClient(),
    requests: [],
  };
  const record = (event: Stripe.RequestEvent): void => {
    stripe.requests.push(`${event.method} ${event.path}`);
  };
  stripe.write.on("request", record);
  stripe.read.on("request", record);
  afterEach(() => {
    vi.restoreAllMocks();
    const sent = stripe.requests.splice(0);
    expect(sent, "Stripe requests no test stubbed").toEqual([]);
  });
  return stripe;
}
