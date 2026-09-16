export type PlanInterval = "month" | "year";
export type PlanIntervalTranslator = (key: string) => string;
export type PlanIntervalLabeler = (interval: PlanInterval) => string;

/**
 * Translates a billing interval.
 *
 * @param interval Stored billing interval
 * @param keyPrefix Translation namespace containing month and year
 * @param translate Translation function
 * @returns Translated interval
 */
export function formatPlanIntervalLabel(
  interval: PlanInterval,
  keyPrefix: string,
  translate: PlanIntervalTranslator,
): string {
  return translate(`${keyPrefix}.${interval}`);
}

/**
 * Provides an interval formatter bound to the current locale.
 *
 * @param keyPrefix Translation namespace containing month and year
 * @returns Formatter for a stored billing interval
 */
export function usePlanIntervalLabel(keyPrefix: string): PlanIntervalLabeler {
  const { t } = useI18n();
  return (interval) => formatPlanIntervalLabel(interval, keyPrefix, t);
}
