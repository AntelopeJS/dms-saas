import { computed, type ComputedRef } from "vue";

interface PlanContactRuntimeConfig {
  planContactUrl?: string | null;
}

/**
 * Where the "Contact us" button of a contact-only plan leads — the
 * `planContactUrl` the deployment configured, or null when it set none and
 * such a plan only reads "on quote".
 */
export function usePlanContactUrl(): ComputedRef<string | null> {
  const config = useDmsRuntimeConfig();
  return computed(
    () =>
      (config.public.dmsSaas as PlanContactRuntimeConfig | undefined)
        ?.planContactUrl ?? null,
  );
}
