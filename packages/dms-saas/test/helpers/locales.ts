import { readdirSync, readFileSync } from "node:fs";

/** A parsed locale catalog, nested as the JSON files are. */
export type LocaleTree = Record<string, unknown>;

const LOCALES_DIRECTORY = new URL(
  "../../frontend-vue/i18n/locales/",
  import.meta.url,
);
const LOCALE_SUFFIX = /-([a-z]{2}-[A-Z]{2})\.json$/;

/** Every catalog file of the layer whose name ends in `-<code>.json`. */
export function localeFiles(code: string): string[] {
  return readdirSync(LOCALES_DIRECTORY)
    .filter((file) => LOCALE_SUFFIX.exec(file)?.[1] === code)
    .sort();
}

function readLocaleFile(file: string): LocaleTree {
  return JSON.parse(
    readFileSync(new URL(file, LOCALES_DIRECTORY), "utf-8"),
  ) as LocaleTree;
}

function isTree(value: unknown): value is LocaleTree {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function mergeTrees(target: LocaleTree, source: LocaleTree): LocaleTree {
  for (const [key, value] of Object.entries(source)) {
    const existing = target[key];
    target[key] =
      isTree(existing) && isTree(value) ? mergeTrees(existing, value) : value;
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

/** Every leaf key of one catalog file, dotted. */
export function flattenLocale(
  tree: LocaleTree,
  prefix = "",
): Map<string, string> {
  const entries = new Map<string, string>();
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (isTree(value)) {
      for (const [nested, leaf] of flattenLocale(value, path)) {
        entries.set(nested, leaf);
      }
      continue;
    }
    entries.set(path, String(value));
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
