import { onUnmounted } from "vue";

interface UseStripePaymentElementOptions {
  publishableKey: string;
  clientSecret: string;
  containerId: string;
}

interface ConfirmResult {
  paymentMethodId?: string;
  error?: { message: string };
}

interface StripePaymentElementHandle {
  confirmAndGetPaymentMethod: () => Promise<ConfirmResult>;
}

// Payment method types are fixed server-side on the SetupIntent: Stripe
// rejects `paymentMethodTypes` next to a `clientSecret`, since it only applies
// to an Elements instance created in deferred-intent `mode`.
const ALLOWED_CARD_BRANDS = ["visa", "mastercard"];

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
    const result = await stripeInstance.confirmSetup({
      elements: elementsInstance,
      redirect: "if_required",
    });
    if (result.error) {
      return { error: { message: result.error.message } };
    }
    const paymentMethodId = result.setupIntent?.payment_method;
    if (typeof paymentMethodId !== "string") {
      return { error: { message: "No payment method returned" } };
    }
    return { paymentMethodId };
  }

  onUnmounted(() => {
    elementsInstance = null;
    stripeInstance = null;
  });

  void init();

  return { confirmAndGetPaymentMethod };
}
