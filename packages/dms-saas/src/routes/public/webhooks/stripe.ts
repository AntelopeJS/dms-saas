import {
  Controller,
  HTTPResult,
  Parameter,
  Post,
  RawBody,
} from "@antelopejs/interface-api";
import type Stripe from "stripe";
import {
  dispatchStripeWebhookEvent,
  getStripeClient,
  getStripeWebhookSecret,
} from "../../../stripe";

const HTTP_BAD_REQUEST = 400;

export class StripeWebhookController extends Controller(
  "/api/saas/webhooks/stripe",
) {
  @Post("/")
  async receive(
    @RawBody() rawBody: Buffer,
    @Parameter("stripe-signature", "header") signature: string,
  ) {
    let event: Stripe.Event;
    try {
      event = getStripeClient().webhooks.constructEvent(
        rawBody,
        signature,
        getStripeWebhookSecret(),
      );
    } catch {
      throw new HTTPResult(
        HTTP_BAD_REQUEST,
        "saas.errors.webhook.invalid_signature",
      );
    }
    await dispatchStripeWebhookEvent(event);
    return { received: true };
  }
}
