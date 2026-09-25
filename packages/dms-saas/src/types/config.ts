import type { RegistrationPaymentMethodPolicy } from "@antelopejs/interface-dms-saas/registration";

export interface DmsSaasStripeConfig {
  secretKey: string;
  webhookSecret: string;
  publishableKey: string;
}

/**
 * Bundled public screens, each keyed by its page slug. A screen left out —
 * or set to `true` — is served by dms-saas; `false` frees the slug for the
 * consumer's own page.
 */
export interface DmsSaasPublicScreensConfig {
  register?: boolean;
}

export type PublicScreenId = keyof DmsSaasPublicScreensConfig;

/** Public registration flow settings. */
export interface DmsSaasRegistrationConfig {
  /**
   * Whether registration asks for a card. Defaults to `required`; `optional`
   * lets the visitor skip the card step, `none` never shows it and never
   * calls Stripe.
   */
  paymentMethod?: RegistrationPaymentMethodPolicy;
}

export interface DmsSaasConfig {
  stripe: DmsSaasStripeConfig;
  /** Deployment-wide admission policy. Defaults to open; invitations remain available. */
  admissionMode?: "open" | "invitation-only";
  /** Public registration flow settings. Invitation sign-up ignores them. */
  registration?: DmsSaasRegistrationConfig;
  /**
   * Server-selected named storage for private support uploads. Keep the name's
   * backend binding stable while any support admission or file remains retained.
   */
  supportStorage?: string;
  /**
   * Opt out of the reference screens this module ships, to replace them with
   * your own pages. Every screen is registered by default.
   */
  publicScreens?: DmsSaasPublicScreensConfig;
  /**
   * Hosts allowed as `return_url` for the Stripe billing portal and other
   * outbound redirects. Values are matched against URL.host; only http(s)
   * URLs are considered. In a development runtime, loopback hosts are
   * accepted automatically and need no entry here.
   */
  allowedRedirectHosts?: string[];
  /**
   * Slug of the free plan every workspace falls back to, so none is ever left
   * without a plan. Defaults to the lowest-ordered active free plan open to
   * individuals; a slug naming no such plan is ignored with a warning.
   */
  defaultPlanSlug?: string;
  /**
   * i18n key prefixes the plan pages look up feature labels under, tried in
   * order before `saas.plan_features`: for a prefix `p`, the label of feature
   * `f` is `p.f.label` and its tooltip `p.f.tooltip`. A module ships those keys
   * in its own frontend locale files; a missing key falls back to the
   * feature's stored display name and tooltip.
   */
  planFeatureTranslationPrefixes?: string[];
}
