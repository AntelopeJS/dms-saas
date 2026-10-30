/**
 * The types of the DMS's `useApiData` (its `dms-core` layer), for the tests
 * that stand in for it: the layer is not a package entry, so it is read by
 * path, types only.
 */
export type {
  ApiDataHandler,
  UseApiDataOptions,
} from "../../node_modules/@antelopejs/dms/frontend-vue/layers/dms-core/app/composables/auth/useApiData";
export type { ApiDataRequest } from "./api-data-request";
