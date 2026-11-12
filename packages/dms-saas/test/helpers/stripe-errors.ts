import Stripe from "stripe";

const HTTP_BAD_REQUEST = 400;

/** The error Stripe answers a request it refuses as invalid with. */
export function invalidRequest(
  message: string,
  param?: string,
): Stripe.errors.StripeInvalidRequestError {
  return new Stripe.errors.StripeInvalidRequestError({
    message,
    param,
    type: "invalid_request_error",
    statusCode: HTTP_BAD_REQUEST,
  });
}

/** The error the Stripe client raises when its request never got an answer. */
export function connectionLost(): Stripe.errors.StripeConnectionError {
  return new Stripe.errors.StripeConnectionError({
    message: "An error occurred with our connection to Stripe.",
    type: "api_error",
  });
}
