import type { MaybeRefOrGetter } from "./vue-runtime/index.mjs";

/**
 * What `useApiData(url, ...)` accepts as its URL: the shape of dms-core's
 * `ApiDataRequest`, spelled with the Vue the tests run on because the linter
 * cannot resolve the `vue` that alias is written with.
 */
export type ApiDataRequest = MaybeRefOrGetter<string | null | undefined>;
