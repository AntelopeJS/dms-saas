export const MS_PER_DAY = 86400000;
export const MS_PER_SECOND = 1000;

export function stripeSecondsToDate(
  seconds: number | null | undefined,
): Date | null {
  return typeof seconds === "number" ? new Date(seconds * MS_PER_SECOND) : null;
}
