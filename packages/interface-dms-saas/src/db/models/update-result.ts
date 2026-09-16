interface UpdateCounts {
  matchedCount?: number;
  modifiedCount?: number;
  replaced?: number;
  unchanged?: number;
}

/** Reports whether a conditional update selected a row across DB adapters. */
export function hasSelectedRow(result: unknown): boolean {
  if (typeof result === "number") return result > 0;
  const counts = result as UpdateCounts | undefined;
  return Boolean(
    counts?.matchedCount ||
    counts?.modifiedCount ||
    counts?.replaced ||
    counts?.unchanged,
  );
}
