const SWITCH_TENANT_ENDPOINT = "/auth/switch-tenant";

/**
 * A full page load is required, not a router navigation: the tenant lives in
 * the session cookie and every already-fetched page payload belongs to the
 * previous one.
 */
export async function useTenantSwitch(
  tenantId: string,
  redirectTo?: string,
): Promise<void> {
  await $fetch(SWITCH_TENANT_ENDPOINT, {
    method: "POST",
    body: { tenantId },
  });
  if (typeof window === "undefined") return;
  if (redirectTo) {
    window.location.href = redirectTo;
    return;
  }
  window.location.reload();
}
