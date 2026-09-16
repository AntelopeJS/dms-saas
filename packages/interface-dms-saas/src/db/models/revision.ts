interface UpdateResult {
  replaced?: number;
  modifiedCount?: number;
  deleted?: number;
  deletedCount?: number;
}

export function updatedRows(result: unknown): number {
  if (typeof result === "number") return result;
  const counts = result as UpdateResult | undefined;
  return Number(
    counts?.replaced ??
      counts?.modifiedCount ??
      counts?.deleted ??
      counts?.deletedCount ??
      0,
  );
}
