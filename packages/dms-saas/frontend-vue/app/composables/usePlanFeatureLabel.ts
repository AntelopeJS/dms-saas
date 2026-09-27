/** The part of a feature definition its label and tooltip come from. */
export interface LabelledFeature {
  displayName: string;
  tooltip: string | null;
}

/**
 * Feature label and tooltip readers for the plan pages. Both follow the DMS
 * display string convention: a stored value starting with `$` is an i18n key
 * the declaring module ships in its own locales, anything else is shown as
 * written. A `$` tooltip missing from the locales is hidden rather than shown
 * as a bare key path.
 */
export function usePlanFeatureLabel() {
  const { t } = useI18n();
  const { processI18n } = useTranslation();

  return {
    featureLabel: (feature: LabelledFeature) =>
      processI18n(feature.displayName),
    featureTooltip: (feature: LabelledFeature) =>
      resolveOptionalI18nKey(t, feature.tooltip ?? undefined) ?? null,
  };
}
