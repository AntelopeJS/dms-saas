import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import {
  buildSetupConfirmation,
  toConfirmResult,
  useStripePaymentElement,
} from "../frontend-vue/app/composables/useStripePaymentElement";

const stripe = (() => {
  const created: { mount: Mock; destroy: Mock }[] = [];
  const paymentElement = () => {
    const element = { mount: vi.fn(), destroy: vi.fn() };
    created.push(element);
    return element;
  };
  const elements = {
    create: vi.fn((_type: string, _options: object) => paymentElement()),
  };
  return {
    confirmSetup: vi.fn(),
    created,
    elements,
    elementsFor: vi.fn((_options: { clientSecret: string }) => elements),
  };
})();

/**
 * Stands in for the Stripe.js script in a browser page: once loaded, it
 * defines `window.Stripe`, which `loadStripe` calls with the publishable key.
 */
const stripeJs = vi.fn((_publishableKey: string) => ({
  elements: stripe.elementsFor,
  confirmSetup: stripe.confirmSetup,
}));
vi.stubGlobal("document", {});
vi.stubGlobal("window", { Stripe: stripeJs });

const PAYER_EMAIL = "owner@example.com";
const PAYMENT_METHOD_ID = "pm_card_visa";
const INTEGRATION_ERROR =
  'You specified "never" for fields.billing_details.email when creating the payment Element';

async function mountedHandle(email: () => string) {
  const handle = useStripePaymentElement({
    publishableKey: "pk_test_key",
    clientSecret: "seti_secret",
    containerId: "payment-element",
    billingEmail: email,
  });
  await vi.waitFor(async () => {
    stripe.confirmSetup.mockResolvedValueOnce({
      setupIntent: { payment_method: PAYMENT_METHOD_ID },
    });
    expect(await handle.confirmAndGetPaymentMethod()).toEqual({
      paymentMethodId: PAYMENT_METHOD_ID,
    });
  });
  stripe.confirmSetup.mockReset();
  return handle;
}

beforeEach(() => {
  stripe.confirmSetup.mockReset();
});

describe("setup confirmation parameters", () => {
  it("sends the payer's email the Payment Element does not collect", () => {
    const elements = {};

    expect(buildSetupConfirmation(elements, PAYER_EMAIL)).toEqual({
      elements,
      redirect: "if_required",
      confirmParams: {
        payment_method_data: { billing_details: { email: PAYER_EMAIL } },
      },
    });
  });
});

describe("setup confirmation outcome", () => {
  it("returns the confirmed payment method", () => {
    expect(
      toConfirmResult({ setupIntent: { payment_method: PAYMENT_METHOD_ID } }),
    ).toEqual({ paymentMethodId: PAYMENT_METHOD_ID });
  });

  it("keeps Stripe's own reason for a declined card", () => {
    expect(
      toConfirmResult({ error: { message: "Your card was declined." } }),
    ).toEqual({ error: { message: "Your card was declined." } });
  });
});

describe("useStripePaymentElement", () => {
  it("confirms the card with the email read at submit time", async () => {
    let email = "draft@example.com";
    const handle = await mountedHandle(() => email);
    email = PAYER_EMAIL;
    stripe.confirmSetup.mockResolvedValueOnce({
      setupIntent: { payment_method: PAYMENT_METHOD_ID },
    });

    await expect(handle.confirmAndGetPaymentMethod()).resolves.toEqual({
      paymentMethodId: PAYMENT_METHOD_ID,
    });
    expect(stripe.confirmSetup).toHaveBeenCalledWith(
      buildSetupConfirmation(stripe.elements, PAYER_EMAIL),
    );
  });

  it("passes only options the Payment Element supports", async () => {
    await mountedHandle(() => PAYER_EMAIL);

    expect(stripeJs).toHaveBeenLastCalledWith("pk_test_key");
    const [, elementOptions] = stripe.elements.create.mock.lastCall ?? [];
    expect(Object.keys(elementOptions ?? {}).sort()).toEqual([
      "fields",
      "wallets",
    ]);
  });

  it("takes another card on a fresh SetupIntent once one was confirmed", async () => {
    const handle = await mountedHandle(() => PAYER_EMAIL);
    const spent = stripe.created.at(-1);

    await handle.renew("seti_secret_fresh");

    expect(stripe.elementsFor).toHaveBeenLastCalledWith({
      clientSecret: "seti_secret_fresh",
    });
    expect(spent?.destroy).toHaveBeenCalled();
    const fresh = stripe.created.at(-1);
    expect(fresh).not.toBe(spent);
    expect(fresh?.mount).toHaveBeenCalledWith("#payment-element");
  });

  it("reports an error Stripe.js throws instead of rejecting", async () => {
    const handle = await mountedHandle(() => PAYER_EMAIL);
    stripe.confirmSetup.mockRejectedValueOnce(new Error(INTEGRATION_ERROR));

    await expect(handle.confirmAndGetPaymentMethod()).resolves.toEqual({
      error: { message: INTEGRATION_ERROR },
    });
  });
});
