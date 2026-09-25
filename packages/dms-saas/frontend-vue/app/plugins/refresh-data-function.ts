import type { Ref } from "vue";

// Named in the watch actions the backend declares (see the workspaces
// back-office page): a component watching an event through it refetches.
const REFRESH_FUNCTION_ID = "DmsSaas.RefreshData";
const REFRESHED_AT_KEY = "refreshedAt";

/** Changing the watch state is what makes a fetching component refetch. */
function markRefreshed(
  _action: unknown,
  _eventData: unknown,
  componentState: Ref<Record<string, unknown>>,
): void {
  componentState.value = {
    ...componentState.value,
    [REFRESHED_AT_KEY]: Date.now(),
  };
}

export default defineDmsPlugin(() => {
  useDefinedFunctions().registerFunction(REFRESH_FUNCTION_ID, markRefreshed);
});
