import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import type {
  BlockText,
  ComposedText,
  ComposedTextParam,
  ComposedTextTypedParam,
} from "@antelopejs/interface-dms/base";

/**
 * Texts a route words for the blocks that take no composed text (the
 * `NavCardGrid` cards, the `TopListCard` descriptions, the `ActivityFeed`
 * meta): the route reads the module's own frontend catalogs, in the locale
 * the DMS frontend states on each request, and formats amounts and dates for
 * it. Every block that takes a `ComposedText` gets one instead, written by
 * the browser.
 */
export interface ServerMessages {
  locale: string;
  t: (key: string, params?: MessageParams) => string;
  /** An amount in minor units, as the frontend's `formatMinorUnits` shows it. */
  money: (amountMinor: number, currency: string) => string;
  /** A day: "Oct 4", with the year when it is not the current one. */
  day: (date: Date) => string;
  /**
   * A composed text written out, for a block that only takes a string: the
   * texts a `StatGroup` composes in the browser, worded the same here.
   */
  compose: (text: BlockText) => string;
}

export type MessageParams = Record<string, string | number>;

type CatalogTree = { [key: string]: CatalogTree | string };

// Each catalog file is named `<area>-<locale>.json`, as dms-frontend merges
// them; the module ships `en-GB` and `fr-FR`.
const LOCALES_DIRECTORY = path.join(
  __dirname,
  "../../frontend-vue/i18n/locales",
);
const LOCALE_SUFFIX = /-([a-z]{2}-[A-Z]{2})\.json$/;
const FALLBACK_LOCALE = "en-GB";
const MINOR_UNITS_PER_UNIT = 100;
const PLURAL_SEPARATOR = " | ";
const TWO_FORMS = 2;
const PARAM_PATTERN = /\{\s*(?:'([^']*)'|(\w+))\s*\}/g;
const DAY_FORMAT: Intl.DateTimeFormatOptions = {
  month: "short",
  day: "numeric",
};
const DAY_WITH_YEAR_FORMAT: Intl.DateTimeFormatOptions = {
  ...DAY_FORMAT,
  year: "numeric",
};

const catalogs = new Map<string, CatalogTree>();

function isTree(value: unknown): value is CatalogTree {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function mergeTrees(target: CatalogTree, source: CatalogTree): CatalogTree {
  for (const [key, value] of Object.entries(source)) {
    const existing = target[key];
    target[key] =
      isTree(existing) && isTree(value) ? mergeTrees(existing, value) : value;
  }
  return target;
}

function availableLocales(): string[] {
  const codes = readdirSync(LOCALES_DIRECTORY)
    .map((file) => LOCALE_SUFFIX.exec(file)?.[1])
    .filter((code): code is string => !!code);
  return [...new Set(codes)];
}

function loadCatalog(locale: string): CatalogTree {
  const cached = catalogs.get(locale);
  if (cached) return cached;
  const catalog = readdirSync(LOCALES_DIRECTORY)
    .filter((file) => LOCALE_SUFFIX.exec(file)?.[1] === locale)
    .sort()
    .map(
      (file) =>
        JSON.parse(
          readFileSync(path.join(LOCALES_DIRECTORY, file), "utf-8"),
        ) as CatalogTree,
    )
    .reduce<CatalogTree>(mergeTrees, {});
  catalogs.set(locale, catalog);
  return catalog;
}

/** The catalog locale closest to the one requested: same code, else same language. */
export function resolveMessagesLocale(requested: unknown): string {
  const locales = availableLocales();
  const wanted = typeof requested === "string" ? requested : "";
  const language = wanted.split("-")[0]?.toLowerCase();
  return (
    locales.find((code) => code.toLowerCase() === wanted.toLowerCase()) ??
    locales.find((code) => code.split("-")[0] === language) ??
    FALLBACK_LOCALE
  );
}

function lookup(catalog: CatalogTree, key: string): string | undefined {
  const value = key
    .split(".")
    .reduce<CatalogTree | string | undefined>(
      (node, part) => (isTree(node) ? node[part] : undefined),
      catalog,
    );
  return typeof value === "string" ? value : undefined;
}

// vue-i18n's default rule: two forms are one / other, three are zero / one /
// other.
function pluralForm(message: string, params: MessageParams): string {
  const forms = message.split(PLURAL_SEPARATOR);
  const count = Number(params.count ?? params.n);
  if (forms.length < TWO_FORMS || !Number.isFinite(count)) return message;
  const index =
    forms.length === TWO_FORMS
      ? Number(count !== 1)
      : Math.min(count, TWO_FORMS);
  return forms[index] ?? message;
}

function interpolate(message: string, params: MessageParams): string {
  return message.replace(
    PARAM_PATTERN,
    (match, literal: string | undefined, name: string | undefined) => {
      if (literal !== undefined) return literal;
      const value = name ? params[name] : undefined;
      return value === undefined ? match : String(value);
    },
  );
}

type Translate = ServerMessages["t"];

interface ComposeContext {
  t: Translate;
  money: ServerMessages["money"];
  day: ServerMessages["day"];
  locale: string;
}

const KEY_PREFIX = "$";

function isComposedText(value: unknown): value is ComposedText {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as ComposedText).key === "string"
  );
}

// A relative date is written as its day: the server cannot know when the
// text is read, the browser does it for the blocks that compose.
const TYPED_PARAMS: Record<
  ComposedTextTypedParam["type"],
  (param: ComposedTextTypedParam, context: ComposeContext) => string
> = {
  money: (param, { money }) =>
    param.type === "money" ? money(param.value, param.currency) : "",
  date: (param, { day }) => day(new Date(param.value)),
  datetime: (param, { day }) => day(new Date(param.value)),
  relative: (param, { day }) => day(new Date(param.value)),
  number: (param, { locale }) =>
    new Intl.NumberFormat(locale).format(Number(param.value)),
  count: (param, { locale }) =>
    new Intl.NumberFormat(locale).format(Number(param.value)),
};

function writeParam(param: ComposedTextParam, context: ComposeContext): string {
  if (typeof param === "string") return param;
  if (typeof param === "number")
    return new Intl.NumberFormat(context.locale).format(param);
  if (isComposedText(param)) return composeText(param, context);
  return TYPED_PARAMS[param.type](param, context);
}

function pluralCount(text: ComposedText): number | undefined {
  const params = text.params ?? {};
  const name =
    text.plural ??
    Object.keys(params).find((candidate) => {
      const param = params[candidate];
      return (
        typeof param === "object" && "type" in param && param.type === "count"
      );
    });
  const param = name === undefined ? undefined : params[name];
  if (typeof param === "number") return param;
  return typeof param === "object" && "type" in param
    ? Number(param.value)
    : undefined;
}

function composeText(text: ComposedText, context: ComposeContext): string {
  const params: MessageParams = Object.fromEntries(
    Object.entries(text.params ?? {}).map(([name, param]) => [
      name,
      writeParam(param, context),
    ]),
  );
  const count = pluralCount(text);
  if (count !== undefined) params.count ??= count;
  return context.t(text.key.replace(/^\$/, ""), params);
}

function composeBlockText(text: BlockText, context: ComposeContext): string {
  if (isComposedText(text)) return composeText(text, context);
  return text.startsWith(KEY_PREFIX) ? context.t(text.slice(1)) : text;
}

/** Words messages, amounts and days in the locale a request states. */
export function serverMessages(requestedLocale: unknown): ServerMessages {
  const locale = resolveMessagesLocale(requestedLocale);
  const catalog = loadCatalog(locale);
  const fallback = loadCatalog(FALLBACK_LOCALE);
  const now = new Date();
  const context: ComposeContext = {
    locale,
    t: (key, params = {}) => {
      const message = lookup(catalog, key) ?? lookup(fallback, key) ?? key;
      return interpolate(pluralForm(message, params), params);
    },
    money: (amountMinor, currency) =>
      new Intl.NumberFormat(locale, {
        style: "currency",
        currency: currency.toUpperCase(),
      }).format(amountMinor / MINOR_UNITS_PER_UNIT),
    day: (date) =>
      new Intl.DateTimeFormat(
        locale,
        date.getFullYear() === now.getFullYear()
          ? DAY_FORMAT
          : DAY_WITH_YEAR_FORMAT,
      ).format(date),
  };
  return { ...context, compose: (text) => composeBlockText(text, context) };
}
