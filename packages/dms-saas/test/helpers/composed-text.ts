import type {
  BlockText,
  ComposedTextCountParam,
  ComposedTextParam,
} from "@antelopejs/interface-dms/base";
import { flattenLocale, readLocale } from "./locales";
import { isRecord } from "./records";
import { isNumber, isString } from "../../src/utils/primitive-guards";

/** The locales the module ships. */
export const LOCALES = ["en-GB", "fr-FR"];

const KEY_PREFIX = "$";

/**
 * Every i18n key a route payload names: the keys of its composed texts, nested
 * ones included, and its `$`-prefixed strings.
 */
function namedKeys(payload: unknown): string[] {
  if (isString(payload)) {
    return payload.startsWith(KEY_PREFIX) ? [payload.slice(1)] : [];
  }
  if (Array.isArray(payload)) return payload.flatMap(namedKeys);
  if (!isRecord(payload)) return [];
  const own = isString(payload.key) ? [payload.key.replace(/^\$/, "")] : [];
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

type WrittenParams = Map<string, string | number>;

/**
 * Resolves a key in a locale and fills in its params. Picks the plural form by
 * vue-i18n's default rule: two forms are one / other, three zero / one / other.
 */
function translate(code: string, key: string, params: WrittenParams): string {
  const message = flattenLocale(readLocale(code)).get(key) ?? key;
  const forms = message.split(PLURAL_SEPARATOR);
  const count = Number(params.get("count"));
  const index =
    forms.length === TWO_FORMS
      ? Number(count !== 1)
      : Math.min(count, TWO_FORMS);
  const form =
    forms.length > 1 && Number.isFinite(count)
      ? (forms[index] ?? message)
      : message;
  return form.replace(
    PARAM_PATTERN,
    (match: string, literal: string | undefined, name: string | undefined) =>
      literal ??
      (name === undefined ? match : String(params.get(name) ?? match)),
  );
}

function isCountParam(
  param: ComposedTextParam,
): param is ComposedTextCountParam {
  return typeof param === "object" && "type" in param && param.type === "count";
}

function writeParam(param: ComposedTextParam, code: string): string {
  if (isString(param)) return param;
  if (isNumber(param)) {
    return new Intl.NumberFormat(code).format(param);
  }
  if ("key" in param) return writeText(param, code);
  if (param.type === "money") {
    return new Intl.NumberFormat(code, {
      style: "currency",
      currency: param.currency,
    }).format(param.value / MINOR_UNITS_PER_UNIT);
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
export function writeText(text: BlockText | undefined, code = "en-GB"): string {
  if (isString(text)) {
    return text.startsWith(KEY_PREFIX)
      ? translate(code, text.slice(1), new Map())
      : text;
  }
  if (text === undefined) return String(text);
  const rawParams = text.params ?? {};
  const params: WrittenParams = new Map(
    Object.entries(rawParams).map(([name, param]): [string, string] => [
      name,
      writeParam(param, code),
    ]),
  );
  const count = Object.values(rawParams).find(isCountParam);
  if (count) params.set("count", count.value);
  return translate(code, text.key.replace(/^\$/, ""), params);
}
