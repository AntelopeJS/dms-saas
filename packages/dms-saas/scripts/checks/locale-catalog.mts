import {
  duplicatedLocaleKeys,
  flattenLocale,
  localeCodes,
  readLocale,
} from "./locale-files.mts";

/** The locale every other one is held to. */
export const REFERENCE_LOCALE = "en-GB";

/** Keys that must exist in every locale, by the screen that reads them. */
const REQUIRED_KEY_GROUPS = [
  {
    prefix: "saas.public.no_workspace.identity.",
    keys: ["hint", "not_you", "password", "provider"],
    exact: true,
  },
  {
    prefix: "saas.workspace.data_export.history.status.",
    keys: ["ready", "partial", "expired", "failed", "pending"],
    exact: false,
  },
];

/** Messages that name a seat count, which need a singular and a plural form. */
const SEAT_COUNT_KEYS = [
  "saas.tenant_billing.plan.seats_unlimited",
  "saas.tenant_billing.plan_change.subtitle",
  "saas.tenant_billing.plan_change.for_seats",
  "saas.tenant_billing.plan_change.seat_total",
  "saas.tenant_billing.plan_change.too_small",
  "saas.workspace_detail.complimentary.fits",
  "saas.workspace_detail.complimentary.fits_unlimited",
  "saas.workspace_detail.complimentary.exceeds",
  "saas.workspace.general.glance.seats_unlimited",
];
const SINGULAR_AND_PLURAL = /^[^|]+ \| [^|]+$/;
const PLACEHOLDER = /{(\w+)}/g;

function placeholders(message: string): string {
  return [...message.matchAll(PLACEHOLDER)]
    .map((match) => match[1])
    .sort((left, right) => left.localeCompare(right))
    .join(",");
}

function requiredKeyFailures(
  code: string,
  entries: Map<string, string>,
): string[] {
  return REQUIRED_KEY_GROUPS.flatMap(({ prefix, keys, exact }) => {
    const expected = keys.map((key) => `${prefix}${key}`);
    const missing = expected.filter((key) => !entries.has(key));
    const extra = exact
      ? [...entries.keys()].filter(
          (key) => key.startsWith(prefix) && !expected.includes(key),
        )
      : [];
    return [
      ...missing.map((key) => `${code}: missing ${key}`),
      ...extra.map((key) => `${code}: unexpected ${key}`),
    ];
  });
}

function referenceFailures(
  code: string,
  entries: Map<string, string>,
  reference: Map<string, string>,
): string[] {
  if (code === REFERENCE_LOCALE) return [];
  const missing = [...reference.keys()].filter((key) => !entries.has(key));
  const extra = [...entries.keys()].filter((key) => !reference.has(key));
  const drifted = [...reference].filter(
    ([key, message]) =>
      entries.has(key) &&
      placeholders(message) !== placeholders(entries.get(key) ?? ""),
  );
  return [
    ...missing.map((key) => `${code}: missing ${key} of ${REFERENCE_LOCALE}`),
    ...extra.map((key) => `${code}: ${key} is not in ${REFERENCE_LOCALE}`),
    ...drifted.map(
      ([key]) =>
        `${code}: ${key} changes the placeholders of ${REFERENCE_LOCALE}`,
    ),
  ];
}

/**
 * The catalog rules every locale of the layer keeps: each key declared in one
 * file only, the reference keys exactly, no empty message, the placeholders of
 * the reference, the keys screens read, and both forms of a seat count.
 */
export function localeCatalogFailures(): string[] {
  const reference = flattenLocale(readLocale(REFERENCE_LOCALE));
  return localeCodes().flatMap((code) => {
    const entries = flattenLocale(readLocale(code));
    return [
      ...duplicatedLocaleKeys(code).map(
        (key) => `${code}: ${key} is declared in more than one file`,
      ),
      ...referenceFailures(code, entries, reference),
      ...[...entries]
        .filter(([, message]) => message.trim().length === 0)
        .map(([key]) => `${code}: ${key} is empty`),
      ...requiredKeyFailures(code, entries),
      ...SEAT_COUNT_KEYS.filter(
        (key) => !SINGULAR_AND_PLURAL.test(entries.get(key) ?? ""),
      ).map((key) => `${code}: ${key} needs "singular | plural"`),
    ];
  });
}
