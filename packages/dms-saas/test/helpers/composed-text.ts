import { flattenLocale, readLocale } from "./locales";

/** The locales the module ships. */
export const LOCALES = ["en-GB", "fr-FR"];

const KEY_PREFIX = "$";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

/**
 * Every i18n key a route payload names: the keys of its composed texts, nested
 * ones included, and its `$`-prefixed strings.
 */
export function namedKeys(payload: unknown): string[] {
  if (typeof payload === "string") {
    return payload.startsWith(KEY_PREFIX) ? [payload.slice(1)] : [];
  }
  if (Array.isArray(payload)) return payload.flatMap(namedKeys);
  if (!isRecord(payload)) return [];
  const own =
    typeof payload.key === "string" ? [payload.key.replace(/^\$/, "")] : [];
  return [...own, ...Object.values(payload).flatMap(namedKeys)];
}

/** The keys a payload names that a locale lacks. */
export function missingKeys(payload: unknown, code: string): string[] {
  const keys = flattenLocale(readLocale(code));
  return [...new Set(namedKeys(payload))].filter((key) => !keys.has(key));
}
