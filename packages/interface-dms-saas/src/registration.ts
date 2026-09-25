/** Limits applied to public registration extras before hooks receive them. */
export interface RegistrationExtrasLimits {
  maxSerialisedBytes: number;
  maxKeys: number;
  maxDepth: number;
}

/** Bounds consumers can apply before sending registration extras. */
export const REGISTRATION_EXTRAS_LIMITS: RegistrationExtrasLimits = {
  maxSerialisedBytes: 4096,
  maxKeys: 64,
  maxDepth: 4,
};

/**
 * Whether public registration asks for a card: `required` always does,
 * `optional` lets the visitor skip it, `none` never shows the card step and
 * never calls Stripe. A registration without a card lands on the free plan.
 */
export const REGISTRATION_PAYMENT_METHOD_POLICIES = [
  "required",
  "optional",
  "none",
] as const;

export type RegistrationPaymentMethodPolicy =
  (typeof REGISTRATION_PAYMENT_METHOD_POLICIES)[number];

/** Policy applied when the deployment configures none. */
export const DEFAULT_REGISTRATION_PAYMENT_METHOD_POLICY: RegistrationPaymentMethodPolicy =
  "required";
