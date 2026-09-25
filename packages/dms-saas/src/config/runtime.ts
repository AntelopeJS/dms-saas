import { assert } from "@antelopejs/interface-api-util";
import {
  DEFAULT_REGISTRATION_PAYMENT_METHOD_POLICY,
  REGISTRATION_PAYMENT_METHOD_POLICIES,
  type RegistrationPaymentMethodPolicy,
} from "@antelopejs/interface-dms-saas/registration";
import type {
  DmsSaasConfig,
  DmsSaasPlanExemptPermissionsConfig,
} from "../types";
import { isDevMode } from "./dev-mode";

const REDIRECT_PROTOCOLS = ["http:", "https:"];
const LOOPBACK_HOSTNAMES = ["localhost", "127.0.0.1", "::1", "[::1]"];
const HTTP_BAD_REQUEST = 400;
const HTTP_UNAVAILABLE = 503;
const ADMISSION_MODES = ["open", "invitation-only"];
const CONTACT_URL_PROTOCOLS = ["http:", "https:", "mailto:"];

let runtimeConfig: DmsSaasConfig | null = null;

function assertValidAdmissionMode(config: DmsSaasConfig): void {
  if (
    config.admissionMode !== undefined &&
    !ADMISSION_MODES.includes(config.admissionMode)
  ) {
    throw new Error(
      "Invalid dms-saas admissionMode: expected open or invitation-only",
    );
  }
}

function assertValidRegistrationPaymentMethod(config: DmsSaasConfig): void {
  const policy = config.registration?.paymentMethod;
  if (
    policy !== undefined &&
    !REGISTRATION_PAYMENT_METHOD_POLICIES.includes(policy)
  ) {
    throw new Error(
      "Invalid dms-saas registration.paymentMethod: expected required, optional or none",
    );
  }
}

const DEFAULT_PLAN_EXEMPT_PERMISSIONS: Required<DmsSaasPlanExemptPermissionsConfig> =
  {
    personalPages: [
      "settings.user.profile",
      "settings.user.notifications",
      "settings.user.appearance",
      "settings.user.shortcuts",
    ],
    navigation: ["settings", "settings.user", "settings.workspace"],
  };

function assertOptionalNonEmptyStrings(value: unknown, name: string): void {
  if (value === undefined) return;
  const isValid =
    Array.isArray(value) &&
    value.every(
      (entry) => typeof entry === "string" && entry.trim().length > 0,
    );
  if (!isValid) {
    throw new Error(
      `Invalid dms-saas ${name}: expected an array of non-empty strings`,
    );
  }
}

function assertValidPlanExemptPermissions(config: DmsSaasConfig): void {
  const exempt = config.planExemptPermissions;
  assertOptionalNonEmptyStrings(
    exempt?.personalPages,
    "planExemptPermissions.personalPages",
  );
  assertOptionalNonEmptyStrings(
    exempt?.navigation,
    "planExemptPermissions.navigation",
  );
}

function isContactUrl(value: unknown): boolean {
  if (typeof value !== "string") return false;
  try {
    return CONTACT_URL_PROTOCOLS.includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

function assertValidPlanContactUrl(config: DmsSaasConfig): void {
  const url = config.planContactUrl;
  if (url === undefined || isContactUrl(url)) return;
  throw new Error(
    "Invalid dms-saas planContactUrl: expected an http(s) or mailto: URL",
  );
}

export function setRuntimeConfig(config: DmsSaasConfig): void {
  assertValidAdmissionMode(config);
  assertValidRegistrationPaymentMethod(config);
  assertOptionalNonEmptyStrings(
    config.planFeatureTranslationPrefixes,
    "planFeatureTranslationPrefixes",
  );
  assertValidPlanExemptPermissions(config);
  assertValidPlanContactUrl(config);
  runtimeConfig = config;
}

/** Whether public registration asks for a card; invitation sign-up never does. */
export function getRegistrationPaymentMethodPolicy(): RegistrationPaymentMethodPolicy {
  return (
    runtimeConfig?.registration?.paymentMethod ??
    DEFAULT_REGISTRATION_PAYMENT_METHOD_POLICY
  );
}

/** The card setup intent only exists for a registration that may take a card. */
export function assertRegistrationCardAccepted(): void {
  assert(
    getRegistrationPaymentMethodPolicy() !== "none",
    HTTP_BAD_REQUEST,
    "saas.errors.registration.payment_method_disabled",
  );
}

/**
 * The card a registration may go on with under the configured policy.
 *
 * A card sent while the policy is `none` is dropped rather than refused: the
 * deployment promised no Stripe call, and the visitor loses nothing by it.
 *
 * @param paymentMethodId Card confirmed by the visitor, if any
 * @returns The card to provision with, or undefined for a card-less workspace
 * @throws 400 when the policy requires a card and none was sent
 */
export function resolveRegistrationPaymentMethodId(
  paymentMethodId: string | undefined,
): string | undefined {
  const policy = getRegistrationPaymentMethodPolicy();
  if (policy === "none") return undefined;
  assert(
    policy === "optional" || paymentMethodId,
    HTTP_BAD_REQUEST,
    "saas.errors.registration.payment_method_required",
  );
  return paymentMethodId || undefined;
}

export function getDefaultPlanSlug(): string | undefined {
  return runtimeConfig?.defaultPlanSlug;
}

/** Consumer i18n prefixes for plan feature labels, in lookup order. */
export function getPlanFeatureTranslationPrefixes(): string[] {
  return runtimeConfig?.planFeatureTranslationPrefixes ?? [];
}

/** Permissions plan gating leaves to every member, defaults filled in. */
export function getPlanExemptPermissions(): Required<DmsSaasPlanExemptPermissionsConfig> {
  const configured = runtimeConfig?.planExemptPermissions;
  return {
    personalPages:
      configured?.personalPages ??
      DEFAULT_PLAN_EXEMPT_PERMISSIONS.personalPages,
    navigation:
      configured?.navigation ?? DEFAULT_PLAN_EXEMPT_PERMISSIONS.navigation,
  };
}

/** Contact link of contact-only plans, if the deployment configured one. */
export function getPlanContactUrl(): string | null {
  return runtimeConfig?.planContactUrl ?? null;
}

export function getAllowedRedirectHosts(): string[] {
  return runtimeConfig?.allowedRedirectHosts ?? [];
}

/** Returns the explicit server-owned storage binding; support never falls back to default. */
export function getSupportStorage(): string {
  const storage = runtimeConfig?.supportStorage;
  assert(
    typeof storage === "string" && storage.trim().length > 0,
    HTTP_UNAVAILABLE,
    "saas.errors.support.storage_unavailable",
  );
  return storage;
}

/** Public registration is independent of invitation acceptance and account recovery. */
export function assertAdmissionOpen(isPlatformOwner = false): void {
  const HTTP_FORBIDDEN = 403;
  assert(
    isPlatformOwner || runtimeConfig?.admissionMode !== "invitation-only",
    HTTP_FORBIDDEN,
    "saas.errors.registration_closed",
  );
}

function parseRedirectUrl(rawUrl: string): URL | undefined {
  try {
    const parsed = new URL(rawUrl);
    return REDIRECT_PROTOCOLS.includes(parsed.protocol) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function isLoopbackUrl(url: URL): boolean {
  return LOOPBACK_HOSTNAMES.includes(url.hostname);
}

/**
 * Validates an outbound redirect target (Stripe checkout success/cancel
 * URLs, billing portal return URL).
 *
 * Only http(s) URLs pass. In a development runtime, loopback hosts are
 * accepted without configuration; everything else must match the configured
 * `allowedRedirectHosts` by URL.host.
 */
export function isAllowedRedirectUrl(rawUrl: string): boolean {
  const parsed = parseRedirectUrl(rawUrl);
  if (!parsed) return false;
  if (isDevMode() && isLoopbackUrl(parsed)) return true;
  return getAllowedRedirectHosts().includes(parsed.host);
}
