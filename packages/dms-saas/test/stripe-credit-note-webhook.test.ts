import { randomUUID } from "node:crypto";
import { GetModel } from "@antelopejs/interface-database-decorators";
import { describe, expect, it } from "vitest";
import { StripeWebhookEventModel } from "../src/db";
import { StripeWebhookController } from "../src/routes/public/webhooks/stripe";
import { useMongoDatabase } from "./helpers/mongo";
import { SUITE_STRIPE_KEYS, useSuiteStripe } from "./helpers/stripe";

useMongoDatabase("stripe-credit-note-webhook");
const stripe = useSuiteStripe();

interface SignedFixture {
  id: string;
  body: Buffer;
  signature: string;
}

function signedFixture(type: string): SignedFixture {
  const id = `evt_${randomUUID()}`;
  const body = Buffer.from(
    JSON.stringify({
      id,
      object: "event",
      type,
      data: { object: { id: "cn_123", object: "credit_note" } },
    }),
  );
  const signature = stripe.write.webhooks.generateTestHeaderString({
    payload: body.toString(),
    secret: SUITE_STRIPE_KEYS.webhookSecret,
  });
  return { id, body, signature };
}

describe("signed Stripe credit note webhooks", () => {
  it.each(["credit_note.created", "credit_note.voided"])(
    "verifies and dispatches %s",
    async (type) => {
      const fixture = signedFixture(type);

      await expect(
        new StripeWebhookController().receive(fixture.body, fixture.signature),
      ).resolves.toEqual({ received: true });
      await expect(
        GetModel(StripeWebhookEventModel).get(fixture.id),
      ).resolves.toMatchObject({ type, result: "success" });
    },
  );

  it("rejects a credit note fixture with an invalid signature", async () => {
    const fixture = signedFixture("credit_note.created");

    await expect(
      new StripeWebhookController().receive(fixture.body, "invalid"),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      GetModel(StripeWebhookEventModel).get(fixture.id),
    ).resolves.toBeUndefined();
  });
});
