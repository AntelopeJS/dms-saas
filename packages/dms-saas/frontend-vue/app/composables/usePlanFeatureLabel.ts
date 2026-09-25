/** Prefix dms-saas resolves its own feature labels under, after any consumer's. */
const BUILT_IN_PREFIX = "saas.plan_features";

/** The part of a feature definition its label and tooltip come from. */
export interface LabelledFeature {
  featureId: string;
  displayName: string;
  tooltip: string | null;
}

/** Reads the viewer's locale messages; `null` when no prefix has the key. */
export type TranslationLookup = (key: string) => string | null;

function featureTranslationKeys(
  featureId: string,
  field: string,
  prefixes: readonly string[],
): string[] {
  return [...prefixes, BUILT_IN_PREFIX].map(
    (prefix) => `${prefix}.${featureId}.${field}`,
  );
}

function translateFirst(
  keys: string[],
  lookup: TranslationLookup,
): string | null {
  for (const key of keys) {
    const text = lookup(key);
    if (text) return text;
  }
  return null;
}

/**
 * Label a plan page shows for a feature: the first translation found under
 * `<prefix>.<featureId>.label` — consumer prefixes in order, then
 * `saas.plan_features` — else the stored display name.
 *
 * @param feature Feature definition
 * @param prefixes Consumer prefixes, from the tenant plan response
 * @param lookup Locale message reader
 */
export function resolvePlanFeatureLabel(
  feature: LabelledFeature,
  prefixes: readonly string[],
  lookup: TranslationLookup,
): string {
  const keys = featureTranslationKeys(feature.featureId, "label", prefixes);
  return translateFirst(keys, lookup) ?? feature.displayName;
}

/**
 * Tooltip counterpart of {@link resolvePlanFeatureLabel}, resolved under
 * `<prefix>.<featureId>.tooltip` and falling back to the stored tooltip.
 *
 * @param feature Feature definition
 * @param prefixes Consumer prefixes, from the tenant plan response
 * @param lookup Locale message reader
 */
export function resolvePlanFeatureTooltip(
  feature: LabelledFeature,
  prefixes: readonly string[],
  lookup: TranslationLookup,
): string | null {
  const keys = featureTranslationKeys(feature.featureId, "tooltip", prefixes);
  return translateFirst(keys, lookup) ?? feature.tooltip;
}

/**
 * Locale-bound feature label and tooltip readers for the plan pages.
 *
 * @param prefixes Consumer prefixes, from the tenant plan response
 */
export function usePlanFeatureLabel(prefixes: () => readonly string[]) {
  const { t, te, fallbackLocale } = useI18n();

  // `te` only reads the active locale; a key shipped in the fallback locale
  // alone still beats the untranslated stored name.
  function hasTranslation(key: string): boolean {
    const fallbacks = [fallbackLocale.value].flat();
    return (
      te(key) ||
      fallbacks.some((locale) => typeof locale === "string" && te(key, locale))
    );
  }

  const lookup: TranslationLookup = (key) =>
    hasTranslation(key) ? t(key) : null;

  return {
    featureLabel: (feature: LabelledFeature) =>
      resolvePlanFeatureLabel(feature, prefixes(), lookup),
    featureTooltip: (feature: LabelledFeature) =>
      resolvePlanFeatureTooltip(feature, prefixes(), lookup),
  };
}
