import type { Ref } from "vue";

export interface SharedRequest<T> {
  data: Ref<T | null>;
  error: Ref<boolean>;
  load: () => Promise<T | null>;
  refresh: () => Promise<T | null>;
}

/**
 * One payload, many blocks. Page-level surfaces are assembled from independent
 * components that mount together, so a plain per-component fetch multiplies
 * the same request. This keeps the response, the failure flag and the
 * in-flight promise in shared state: `load` serves whatever is already there,
 * `refresh` forces a re-fetch. Failures never reject — they set `error` so
 * every consumer can render the shared failure state and offer a retry
 * instead of silently disappearing.
 */
export function useSharedRequest<T>(
  key: string,
  fetcher: () => Promise<T>,
): SharedRequest<T> {
  const data = useDmsState<T | null>(key, () => null);
  const error = useDmsState(`${key}-error`, () => false);
  const inFlight = useDmsState<Promise<T | null> | null>(
    `${key}-request`,
    () => null,
  );

  function refresh(): Promise<T | null> {
    if (inFlight.value) return inFlight.value;
    const request = fetcher()
      .then((response) => {
        data.value = response;
        error.value = false;
        return response as T | null;
      })
      .catch(() => {
        error.value = true;
        return null;
      })
      .finally(() => {
        inFlight.value = null;
      });
    inFlight.value = request;
    return request;
  }

  function load(): Promise<T | null> {
    return data.value ? Promise.resolve(data.value) : refresh();
  }

  return { data, error, load, refresh };
}
