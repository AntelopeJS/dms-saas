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

/** Public registration flow settings. */
export interface DmsSaasRegistrationConfig {
  /**
   * Whether registration asks for a card. Defaults to `required`; `optional`
   * lets the visitor skip the card step, `none` never shows it and never
   * calls Stripe.
   */
  paymentMethod?: RegistrationPaymentMethodPolicy;
}

/**
 * Permissions a plan never takes away from a workspace member. DMS page
 * metadata carries no "about the signed-in user only" flag, so the personal
 * pages are listed here rather than derived.
 */
export interface DmsSaasPlanExemptPermissionsConfig {
  /**
   * Page ids about the signed-in user alone (profile, notifications…). Every
   * member holds them, their components and actions included, whatever the
   * plan. Defaults to the DMS profile, notifications, appearance and shortcuts
   * pages; a list replaces the defaults.
   */
  personalPages?: string[];
  /**
   * Ids every member holds on their own, without what is nested under them:
   * the settings hub and the categories grouping its pages. Defaults to
   * `settings`, `settings.user` and `settings.workspace`; a list replaces the
   * defaults.
   */
  navigation?: string[];
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
   * Permissions left out of plan gating. A plan's permission list otherwise
   * caps what every member holds: a listed id grants itself and every id
   * nested under it (a page grants its components and actions), and anything
   * outside the list is withheld.
   */
  planExemptPermissions?: DmsSaasPlanExemptPermissionsConfig;
}
