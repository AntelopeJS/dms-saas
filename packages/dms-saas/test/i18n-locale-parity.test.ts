import { describe, expect, it } from "vitest";
import {
  duplicatedLocaleKeys,
  flattenLocale,
  readLocale,
} from "./helpers/locales";

interface LocaleFile {
  code: string;
  path: string;
}

const REFERENCE_LOCALE = "en-GB";
const NO_WORKSPACE_IDENTITY_PREFIX = "saas.public.no_workspace.identity.";
const EXPORT_ROW_STATUS_PREFIX = "saas.workspace.data_export.history.status.";

/**
 * What an export history row can say: the engine's `ExportStatus` values,
 * split by what the archive became (`ready`, `partial`, `expired`).
 */
const EXPORT_ROW_STATES = ["ready", "partial", "expired", "failed", "pending"];

const LOCALE_FILES: LocaleFile[] = [
  { code: REFERENCE_LOCALE, path: "saas-en-GB.json" },
  { code: "fr-FR", path: "saas-fr-FR.json" },
];

function readLocaleEntries(file: LocaleFile): Map<string, string> {
  return flattenLocale(readLocale(file.code));
}

const locales = new Map(
  LOCALE_FILES.map((file) => [file.code, readLocaleEntries(file)] as const),
);
const reference = locales.get(REFERENCE_LOCALE) as Map<string, string>;
const translated = LOCALE_FILES.filter(
  (file) => file.code !== REFERENCE_LOCALE,
);

describe("saas locale files", () => {
  it.each(LOCALE_FILES)("$code declares each key in one file only", (file) => {
    expect(duplicatedLocaleKeys(file.code)).toEqual([]);
  });

  it.each(translated)("$code declares exactly the reference keys", (file) => {
    const entries = locales.get(file.code) as Map<string, string>;

    expect([...entries.keys()].sort()).toEqual([...reference.keys()].sort());
  });

  it.each(LOCALE_FILES)("$code leaves no key untranslated", (file) => {
    const entries = locales.get(file.code) as Map<string, string>;
    const empty = [...entries].filter(([, value]) => value.trim().length === 0);

    expect(empty.map(([key]) => key)).toEqual([]);
  });

  it.each(LOCALE_FILES)(
    "$code names the identity that will own the first workspace",
    (file) => {
      const entries = locales.get(file.code) as Map<string, string>;
      const namespaced = [...entries.keys()].filter((key) =>
        key.startsWith(NO_WORKSPACE_IDENTITY_PREFIX),
      );

      expect(namespaced.sort()).toEqual([
        `${NO_WORKSPACE_IDENTITY_PREFIX}hint`,
        `${NO_WORKSPACE_IDENTITY_PREFIX}not_you`,
        `${NO_WORKSPACE_IDENTITY_PREFIX}password`,
        `${NO_WORKSPACE_IDENTITY_PREFIX}provider`,
      ]);
    },
  );

  it.each(LOCALE_FILES)("$code labels every export history state", (file) => {
    const entries = locales.get(file.code) as Map<string, string>;
    const missing = EXPORT_ROW_STATES.filter(
      (state) => !entries.has(`${EXPORT_ROW_STATUS_PREFIX}${state}`),
    );

    expect(missing).toEqual([]);
  });

  it.each(translated)(
    "$code keeps the interpolation placeholders of the reference",
    (file) => {
      const entries = locales.get(file.code) as Map<string, string>;
      const drifted = [...reference].filter(
        ([key, value]) =>
          placeholders(value) !== placeholders(entries.get(key) ?? ""),
      );

      expect(drifted.map(([key]) => key)).toEqual([]);
    },
  );
});

function placeholders(value: string): string {
  return [...value.matchAll(/{(\w+)}/g)]
    .map((match) => match[1])
    .sort()
    .join(",");
}
