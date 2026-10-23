import { HTTPResult } from "@antelopejs/interface-api";
import { Logging } from "@antelopejs/interface-core/logging";
import Stripe from "stripe";
import { isStripeConfigured } from "./client";

const HTTP_SERVICE_UNAVAILABLE = 503;
const LOG_PREFIX = "[dms-saas:stripe]";

/** Stripe could not serve the request: a bad key, an outage, a rate limit. */
export const STRIPE_UNAVAILABLE_MESSAGE = "saas.errors.stripe.unavailable";
/** The deployment runs without a usable Stripe secret key. */
export const STRIPE_NOT_CONFIGURED_MESSAGE =
  "saas.errors.stripe.not_configured";

/**
 * The Stripe failures that are the platform's, not the request's: a key
 * Stripe refuses or that lacks a permission, the network, Stripe's own 5xx and
 * its rate limit. A declined card or a refused request is the caller's to
 * explain.
 */
const PLATFORM_FAILURES = [
  Stripe.errors.StripeAuthenticationError,
  Stripe.errors.StripePermissionError,
  Stripe.errors.StripeConnectionError,
  Stripe.errors.StripeAPIError,
  Stripe.errors.StripeRateLimitError,
];

/**
 * Whether a failed Stripe call failed because Stripe cannot be used right now,
 * whatever the request: retrying later, or fixing the configuration, is the
 * only way through.
 *
 * @param error What the Stripe SDK threw
 */
export function isStripeUnavailableError(error: unknown): boolean {
  return PLATFORM_FAILURES.some((failure) => error instanceof failure);
}

/**
 * Refuses a request that needs Stripe when the deployment has no usable key,
 * before any call is made: 503 with `saas.errors.stripe.not_configured`.
 */
export function assertStripeConfigured(): void {
  if (!isStripeConfigured())
    throw new HTTPResult(
      HTTP_SERVICE_UNAVAILABLE,
      STRIPE_NOT_CONFIGURED_MESSAGE,
    );
}

/**
 * Runs the Stripe calls of a route. Stripe being unusable (see
 * {@link isStripeUnavailableError}) answers 503 with
 * `saas.errors.stripe.unavailable`, which the screens translate, rather than
 * an unhandled 500; any other failure propagates untouched.
 *
 * @param operation The route's Stripe work
 */
export async function withStripeAvailability<T>(
  operation: () => Promise<T>,
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (!isStripeUnavailableError(error)) throw error;
    Logging.Error(`${LOG_PREFIX} Stripe is unavailable`, error);
    throw new HTTPResult(HTTP_SERVICE_UNAVAILABLE, STRIPE_UNAVAILABLE_MESSAGE);
  }
}
