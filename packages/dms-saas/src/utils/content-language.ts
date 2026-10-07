import { FEATURE_FALLBACK_LOCALE } from "@antelopejs/interface-dms-saas/db";

/** Header the DMS frontend states the reader's locale in on every request. */
export const CONTENT_LANGUAGE_HEADER = "x-content-language";

/**
 * Locale to read localized content in: the request's, else the fallback one
 * localized fields are always written in.
 *
 * @param header Value of {@link CONTENT_LANGUAGE_HEADER}
 */
export function requestLocale(header: unknown): string {
  return typeof header === "string" && header.length > 0
    ? header
    : FEATURE_FALLBACK_LOCALE;
}
