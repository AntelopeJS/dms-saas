import { readdirSync, readFileSync } from "node:fs";

/** A value of a locale catalog: a message, or a nested group of them. */
export type LocaleValue = string | LocaleTree;

/** A parsed locale catalog, nested as the JSON files are. */
export interface LocaleTree {
  [key: string]: LocaleValue;
}

const LOCALES_DIRECTORY = new URL(
  "../../frontend-vue/i18n/locales/",
  import.meta.url,
);
const LOCALE_SUFFIX = /-([a-z]{2}-[A-Z]{2})\.json$/;

/** The locale codes the layer ships, from its catalog file names. */
export function localeCodes(): string[] {
  const codes = readdirSync(LOCALES_DIRECTORY).flatMap((file) => {
    const code = LOCALE_SUFFIX.exec(file)?.[1];
    return code ? [code] : [];
  });
  return [...new Set(codes)].sort((left, right) => left.localeCompare(right));
}

/** Every catalog file of the layer whose name ends in `-<code>.json`. */
export function localeFiles(code: string): string[] {
  return readdirSync(LOCALES_DIRECTORY)
    .filter((file) => LOCALE_SUFFIX.exec(file)?.[1] === code)
    .sort((left, right) => left.localeCompare(right));
}

/** Whether a catalog value is a message rather than a group. */
function isMessage(value: LocaleValue): value is string {
  return typeof value === "string";
}

/** Whether a parsed JSON value is a message, or a group of them all the way down. */
function isLocaleValue(value: unknown): value is LocaleValue {
  return typeof value === "string" || isLocaleTree(value);
}

/** Whether a parsed JSON value is a catalog: groups of messages, all the way down. */
export function isLocaleTree(value: unknown): value is LocaleTree {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    return false;
  return Object.values(value).every(isLocaleValue);
}

/** One catalog file of the layer, by name (`saas-en-GB.json`). */
export function readLocaleFile(file: string): LocaleTree {
  const catalog = JSON.parse(
    readFileSync(new URL(file, LOCALES_DIRECTORY), "utf-8"),
  );
  if (!isLocaleTree(catalog))
    throw new Error(`${file} is not a catalog of messages`);
  return catalog;
}

function mergeTrees(target: LocaleTree, source: LocaleTree): LocaleTree {
  for (const [key, value] of Object.entries(source)) {
    const existing = target[key];
    target[key] =
      existing !== undefined && !isMessage(existing) && !isMessage(value)
        ? mergeTrees(existing, value)
        : value;
  }
  return target;
}

/**
 * The catalog the frontend serves for one locale: dms-frontend merges every
 * `*-<code>.json` file of the layer, so the module's keys may be split by area.
 * Accepts a locale code (`en-GB`) or the name of one of its files
 * (`saas-en-GB.json`).
 */
export function readLocale(codeOrFile: string): LocaleTree {
  const code = LOCALE_SUFFIX.exec(codeOrFile)?.[1] ?? codeOrFile;
  return localeFiles(code).reduce<LocaleTree>(
    (catalog, file) => mergeTrees(catalog, readLocaleFile(file)),
    {},
  );
}

/** Every leaf key of one catalog, dotted, with its message. */
export function flattenLocale(
  tree: LocaleTree,
  prefix = "",
): Map<string, string> {
  const entries = new Map<string, string>();
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (isMessage(value)) {
      entries.set(path, value);
      continue;
    }
    for (const [nested, leaf] of flattenLocale(value, path)) {
      entries.set(nested, leaf);
    }
  }
  return entries;
}

/** Leaf keys declared by more than one file of a locale. */
export function duplicatedLocaleKeys(code: string): string[] {
  const owners = new Map<string, number>();
  for (const file of localeFiles(code)) {
    for (const key of flattenLocale(readLocaleFile(file)).keys()) {
      owners.set(key, (owners.get(key) ?? 0) + 1);
    }
  }
  return [...owners].filter(([, count]) => count > 1).map(([key]) => key);
}
