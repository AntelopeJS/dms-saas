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
function namedKeys(payload: unknown): string[] {
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

const MINOR_UNITS_PER_UNIT = 100;
const PLURAL_SEPARATOR = " | ";
const TWO_FORMS = 2;
const PARAM_PATTERN = /\{\s*(?:'([^']*)'|(\w+))\s*\}/g;
const DAY_FORMAT: Intl.DateTimeFormatOptions = {
  month: "short",
  day: "numeric",
};

type WrittenParams = Record<string, string | number>;

function translate(code: string, key: string, params: WrittenParams): string {
  const message = flattenLocale(readLocale(code)).get(key) ?? key;
  const forms = message.split(PLURAL_SEPARATOR);
  const count = Number(params.count);
  // vue-i18n's default rule: two forms are one / other, three zero / one / other.
  const index =
    forms.length === TWO_FORMS
      ? Number(count !== 1)
      : Math.min(count, TWO_FORMS);
  const form =
    forms.length > 1 && Number.isFinite(count)
      ? (forms[index] ?? message)
      : message;
  return form.replace(PARAM_PATTERN, (match, literal, name) =>
    literal !== undefined ? literal : String(params[name] ?? match),
  );
}

function writeParam(param: unknown, code: string): string {
  if (typeof param === "string") return param;
  if (typeof param === "number") {
    return new Intl.NumberFormat(code).format(param);
  }
  if (!isRecord(param)) return String(param);
  if (typeof param.key === "string") return writeText(param, code);
  if (param.type === "money") {
    return new Intl.NumberFormat(code, {
      style: "currency",
      currency: String(param.currency),
    }).format(Number(param.value) / MINOR_UNITS_PER_UNIT);
  }
  if (param.type === "date") {
    return new Intl.DateTimeFormat(code, DAY_FORMAT).format(
      new Date(String(param.value)),
    );
  }
  return new Intl.NumberFormat(code).format(Number(param.value));
}

/**
 * A route's text written out against the module's catalog, close to what the
 * browser composes, for asserting the wording a payload yields. Dates are
 * written as their day; plurals follow vue-i18n's default rule on `count`.
 */
export function writeText(text: unknown, code = "en-GB"): string {
  if (typeof text === "string") {
    return text.startsWith(KEY_PREFIX)
      ? translate(code, text.slice(1), {})
      : text;
  }
  if (!isRecord(text) || typeof text.key !== "string") return String(text);
  const rawParams = isRecord(text.params) ? text.params : {};
  const params: WrittenParams = Object.fromEntries(
    Object.entries(rawParams).map(([name, param]) => [
      name,
      writeParam(param, code),
    ]),
  );
  const count = Object.values(rawParams).find(
    (param) => isRecord(param) && param.type === "count",
  );
  if (isRecord(count)) params.count = Number(count.value);
  return translate(code, text.key.replace(/^\$/, ""), params);
}
