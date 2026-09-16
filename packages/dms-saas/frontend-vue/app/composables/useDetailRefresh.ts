export interface DetailRefresh {
  trigger: () => void;
  triggerRef: Ref<number>;
}

export function useDetailRefresh(scopeKey: string): DetailRefresh {
  // useDmsState scopes the counter to the current app instance (SSR-safe) instead
  // of a module-level Map, which on the server would leak across requests and
  // could replay a trigger from one request in another for the same scopeKey.
  const counter = useDmsState<number>(`detail-refresh:${scopeKey}`, () => 0);
  return {
    trigger: () => {
      counter.value++;
    },
    triggerRef: counter,
  };
}
