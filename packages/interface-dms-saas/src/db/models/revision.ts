interface UpdateResult {
  replaced?: unknown;
  modifiedCount?: unknown;
  deleted?: unknown;
  deletedCount?: unknown;
}

function isUpdateResult(result: unknown): result is UpdateResult {
  return typeof result === "object" && result !== null;
}

function isRowCount(result: unknown): result is number {
  return typeof result === "number";
}

export function updatedRows(result: unknown): number {
  if (isRowCount(result)) return result;
  const counts = isUpdateResult(result) ? result : undefined;
  return Number(
    counts?.replaced ??
      counts?.modifiedCount ??
      counts?.deleted ??
      counts?.deletedCount ??
      0,
  );
}
