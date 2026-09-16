import Stripe from "stripe";
import { describe, expect, it, vi } from "vitest";

const WEBHOOK_SECRET = "whsec_local_credit_note_fixture";
const stripe = new Stripe("sk_test_local_fixture");
const dispatch = vi.hoisted(() => vi.fn<() => Promise<void>>());

interface SignedFixture {
  body: Buffer;
  signature: string;
}

vi.mock("../src/stripe", () => ({
  dispatchStripeWebhookEvent: (...args: unknown[]) => dispatch(...args),
  getStripeClient: () => stripe,
  getStripeWebhookSecret: () => WEBHOOK_SECRET,
}));

import { StripeWebhookController } from "../src/routes/public/webhooks/stripe";

function signedFixture(type: string): SignedFixture {
  const body = Buffer.from(
    JSON.stringify({
      id: `evt_${type}`,
      object: "event",
      type,
      data: { object: { id: "cn_123", object: "credit_note" } },
    }),
  );
  const signature = stripe.webhooks.generateTestHeaderString({
    payload: body.toString(),
    secret: WEBHOOK_SECRET,
  });
  return { body, signature };
}

describe("signed Stripe credit note webhooks", () => {
  it.each(["credit_note.created", "credit_note.voided"])(
    "verifies and dispatches %s",
    async (type) => {
      dispatch.mockReset();
      const fixture = signedFixture(type);

      await expect(
        new StripeWebhookController().receive(fixture.body, fixture.signature),
      ).resolves.toEqual({ received: true });
      expect(dispatch).toHaveBeenCalledWith(
        expect.objectContaining({ id: `evt_${type}`, type }),
      );
    },
  );

  it("rejects a credit note fixture with an invalid signature", async () => {
    dispatch.mockReset();
    const fixture = signedFixture("credit_note.created");

    await expect(
      new StripeWebhookController().receive(fixture.body, "invalid"),
    ).rejects.toMatchObject({ status: 400 });
    expect(dispatch).not.toHaveBeenCalled();
  });
});
