import { assert } from "@antelopejs/interface-api-util";
import type { DmsSaasConfig } from "../types";
import { isDevMode } from "./dev-mode";

const REDIRECT_PROTOCOLS = ["http:", "https:"];
const LOOPBACK_HOSTNAMES = ["localhost", "127.0.0.1", "::1", "[::1]"];
const HTTP_UNAVAILABLE = 503;
const ADMISSION_MODES = ["open", "invitation-only"];

let runtimeConfig: DmsSaasConfig | null = null;

export function setRuntimeConfig(config: DmsSaasConfig): void {
  if (
    config.admissionMode !== undefined &&
    !ADMISSION_MODES.includes(config.admissionMode)
  ) {
    throw new Error(
      "Invalid dms-saas admissionMode: expected open or invitation-only",
    );
  }
  runtimeConfig = config;
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
