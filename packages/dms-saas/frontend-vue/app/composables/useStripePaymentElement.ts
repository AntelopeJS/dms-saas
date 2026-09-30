import { type MaybeRefOrGetter, onUnmounted, toValue } from "vue";

interface UseStripePaymentElementOptions {
  publishableKey: string;
  clientSecret: string;
  containerId: string;
  /**
   * The payer's email, sent with the card: the Payment Element does not ask
   * for it, since every caller already knows who is paying. Read at confirm
   * time, so a form field may be passed as a getter.
   */
  billingEmail: MaybeRefOrGetter<string>;
}

interface ConfirmError {
  message: string;
}

interface ConfirmResult {
  paymentMethodId?: string;
  error?: ConfirmError;
}

interface SetupIntentSnapshot {
  payment_method?: unknown;
}

interface StripeErrorSnapshot {
  message?: string;
}

interface SetupIntentResult {
  setupIntent?: SetupIntentSnapshot;
  error?: StripeErrorSnapshot;
}

interface BillingDetails {
  email: string;
}

interface PaymentMethodData {
  billing_details: BillingDetails;
}

interface SetupConfirmParams {
  payment_method_data: PaymentMethodData;
}

interface SetupConfirmation {
  elements: unknown;
  redirect: "if_required";
  confirmParams: SetupConfirmParams;
}

interface StripePaymentElementHandle {
  confirmAndGetPaymentMethod: () => Promise<ConfirmResult>;
}

// Payment method types are fixed server-side on the SetupIntent: Stripe
// rejects `paymentMethodTypes` next to a `clientSecret`, since it only applies
// to an Elements instance created in deferred-intent `mode`.
const ALLOWED_CARD_BRANDS = ["visa", "mastercard"];
const UNKNOWN_STRIPE_ERROR = "Stripe could not confirm the card";

/**
 * The `confirmSetup` parameters. The element hides the email field, and
 * Stripe then refuses any confirmation that does not carry the email itself.
 */
export function buildSetupConfirmation(
  elements: unknown,
  email: string,
): SetupConfirmation {
  return {
    elements,
    redirect: "if_required",
    confirmParams: {
      payment_method_data: { billing_details: { email } },
    },
  };
}

/** Maps a `confirmSetup` outcome to the confirmed card, or Stripe's reason. */
export function toConfirmResult(result: SetupIntentResult): ConfirmResult {
  if (result.error) {
    return { error: { message: result.error.message ?? UNKNOWN_STRIPE_ERROR } };
  }
  const paymentMethodId = result.setupIntent?.payment_method;
  if (typeof paymentMethodId !== "string") {
    return { error: { message: "No payment method returned" } };
  }
  return { paymentMethodId };
}

// Stripe.js throws, rather than returns, integration errors: without this
// the caller only sees its own generic failure and the cause is lost.
function toThrownConfirmResult(error: unknown): ConfirmResult {
  const message = error instanceof Error ? error.message : "";
  return { error: { message: message || UNKNOWN_STRIPE_ERROR } };
}

export function useStripePaymentElement(
  options: UseStripePaymentElementOptions,
): StripePaymentElementHandle {
  let stripeInstance: any = null;
  let elementsInstance: any = null;

  async function init(): Promise<void> {
    const { loadStripe } = await import("@stripe/stripe-js");
    stripeInstance = await loadStripe(options.publishableKey);
    if (!stripeInstance) {
      return;
    }
    elementsInstance = stripeInstance.elements({
      clientSecret: options.clientSecret,
    });
    const paymentElement = elementsInstance.create("payment", {
      wallets: { applePay: "never", googlePay: "never" },
      fields: {
        billingDetails: { address: "auto", name: "auto", email: "never" },
      },
      cardBrands: ALLOWED_CARD_BRANDS,
    });
    paymentElement.mount(`#${options.containerId}`);
  }

  async function confirmAndGetPaymentMethod(): Promise<ConfirmResult> {
    if (!stripeInstance || !elementsInstance) {
      return { error: { message: "Stripe not initialized" } };
    }
    try {
      const result: SetupIntentResult = await stripeInstance.confirmSetup(
        buildSetupConfirmation(
          elementsInstance,
          toValue(options.billingEmail),
        ),
      );
      return toConfirmResult(result);
    } catch (error) {
      return toThrownConfirmResult(error);
    }
  }

  onUnmounted(() => {
    elementsInstance = null;
    stripeInstance = null;
  });

  void init();

  return { confirmAndGetPaymentMethod };
}
