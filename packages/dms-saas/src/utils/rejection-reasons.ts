/** The reasons of the rejected results of a `Promise.allSettled`, in order. */
export function rejectionReasons(
  results: readonly PromiseSettledResult<unknown>[],
): unknown[] {
  const reasons: unknown[] = [];
  for (const result of results) {
    if (result.status === "rejected") reasons.push(result.reason);
  }
  return reasons;
}
