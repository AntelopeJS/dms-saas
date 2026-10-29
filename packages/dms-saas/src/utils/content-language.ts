import type { IncomingHttpHeaders } from "node:http";
import { FEATURE_FALLBACK_LOCALE } from "@antelopejs/interface-dms-saas/db";
import { isString } from "./primitive-guards";

/** Header the DMS frontend states the reader's locale in on every request. */
export const CONTENT_LANGUAGE_HEADER = "x-content-language";

/** A request header as Node hands it over: absent, one value, or repeated. */
export type RequestHeaderValue = IncomingHttpHeaders[string];

/**
 * Locale to read localized content in: the request's, else the fallback one
 * localized fields are always written in.
 *
 * @param header Value of {@link CONTENT_LANGUAGE_HEADER}
 */
export function requestLocale(header: RequestHeaderValue): string {
  return isString(header) && header.length > 0
    ? header
    : FEATURE_FALLBACK_LOCALE;
}
