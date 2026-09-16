const MS_PER_SECOND = 1000;

export function nowInStripeSeconds(): number {
  return Math.floor(Date.now() / MS_PER_SECOND);
}

export function computeUnusedPortionCents(
  amountCents: number,
  periodStartSeconds: number | null | undefined,
  periodEndSeconds: number | null | undefined,
  nowSeconds: number,
): number {
  if (
    !periodStartSeconds ||
    !periodEndSeconds ||
    periodEndSeconds <= periodStartSeconds
  ) {
    return 0;
  }
  const remainingSeconds = Math.max(0, periodEndSeconds - nowSeconds);
  const totalSeconds = periodEndSeconds - periodStartSeconds;
  return Math.floor(amountCents * (remainingSeconds / totalSeconds));
}
