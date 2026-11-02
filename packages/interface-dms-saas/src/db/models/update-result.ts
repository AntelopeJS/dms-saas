interface UpdateCounts {
  matchedCount?: unknown;
  modifiedCount?: unknown;
  replaced?: unknown;
  unchanged?: unknown;
}

function isUpdateCounts(result: number | UpdateCounts): result is UpdateCounts {
  return typeof result === "object" && result !== null;
}

function isRowCount(result: number | UpdateCounts): result is number {
  return typeof result === "number";
}

/** Reports whether a conditional update selected a row across DB adapters. */
export function hasSelectedRow(result: number | UpdateCounts): boolean {
  if (isRowCount(result)) return result > 0;
  const counts = isUpdateCounts(result) ? result : undefined;
  return Boolean(
    counts?.matchedCount ||
    counts?.modifiedCount ||
    counts?.replaced ||
    counts?.unchanged,
  );
}
