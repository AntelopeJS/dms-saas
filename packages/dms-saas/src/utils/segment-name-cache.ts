import { GetModel } from "@antelopejs/interface-database-decorators";
import { SegmentModel } from "../db";

const TTL_MS = 30_000;

let cache: { expiresAt: number; names: Map<string, string> } | null = null;

/**
 * Segment id → name map with a short TTL. Row getters on list views resolve
 * segment names per displayed row; caching the (small) segments table avoids
 * one extra DB round-trip per row.
 */
export async function getSegmentNamesCached(): Promise<
  ReadonlyMap<string, string>
> {
  if (cache && Date.now() < cache.expiresAt) return cache.names;
  const segments = await GetModel(SegmentModel).getAll();
  cache = {
    expiresAt: Date.now() + TTL_MS,
    names: new Map(segments.map((s) => [s._id, s.name])),
  };
  return cache.names;
}

/** Drop the cache after a segment create/edit/delete. */
export function invalidateSegmentNamesCache(): void {
  cache = null;
}
