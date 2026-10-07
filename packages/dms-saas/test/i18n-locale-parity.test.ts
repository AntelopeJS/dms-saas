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
const EXPORT_HISTORY_PREFIX = "saas.workspace.data_export.history.";

/** `ExportStatus` of dms-base, which the history rows label one key each. */
const EXPORT_STATUSES = ["pending", "completed", "failed"];

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

  it.each(LOCALE_FILES)(
    "$code carries the export history namespace",
    (file) => {
      const entries = locales.get(file.code) as Map<string, string>;
      const namespaced = [...entries.keys()].filter((key) =>
        key.startsWith(EXPORT_HISTORY_PREFIX),
      );

      expect(namespaced.sort()).toEqual([
        `${EXPORT_HISTORY_PREFIX}download`,
        `${EXPORT_HISTORY_PREFIX}empty`,
        `${EXPORT_HISTORY_PREFIX}error_download`,
        `${EXPORT_HISTORY_PREFIX}error_expired`,
        `${EXPORT_HISTORY_PREFIX}error_load`,
        `${EXPORT_HISTORY_PREFIX}expired`,
        `${EXPORT_HISTORY_PREFIX}expires_at`,
        `${EXPORT_HISTORY_PREFIX}next`,
        `${EXPORT_HISTORY_PREFIX}page`,
        `${EXPORT_HISTORY_PREFIX}previous`,
        `${EXPORT_HISTORY_PREFIX}scope`,
        `${EXPORT_HISTORY_PREFIX}status_completed`,
        `${EXPORT_HISTORY_PREFIX}status_failed`,
        `${EXPORT_HISTORY_PREFIX}status_partial`,
        `${EXPORT_HISTORY_PREFIX}status_pending`,
        `${EXPORT_HISTORY_PREFIX}title`,
      ]);
    },
  );

  it.each(LOCALE_FILES)("$code labels every export job status", (file) => {
    const entries = locales.get(file.code) as Map<string, string>;
    const missing = EXPORT_STATUSES.filter(
      (status) => !entries.has(`${EXPORT_HISTORY_PREFIX}status_${status}`),
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
