import type { UpcomingInvoicePreview } from "@antelopejs/interface-dms-saas/billing";
import { BasicDataModel } from "@antelopejs/interface-database-decorators";
import {
  UpcomingInvoicePreviewEntry,
  upcomingInvoicePreviewsTableName,
} from "./preview-cache.table";

type EntryPatch = Partial<Omit<UpcomingInvoicePreviewEntry, "_id">>;

/** What a cached preview must still match to be served. */
export interface PreviewCacheLookup {
  tenantId: string;
  sourceVersion: string;
  computedNotBefore: Date;
}

/** A computed preview and the state it was computed from. */
export interface PreviewCacheWrite {
  tenantId: string;
  preview: UpcomingInvoicePreview;
  sourceVersion: string;
  computedAt: Date;
}

const EMPTY_ENTRY: EntryPatch = {
  preview: null,
  sourceVersion: null,
  computedAt: null,
  invalidatedAt: null,
};

function timeOf(date: Date | null | undefined): number | null {
  return date ? new Date(date).getTime() : null;
}

function isFresh(
  entry: UpcomingInvoicePreviewEntry,
  lookup: PreviewCacheLookup,
): boolean {
  const computedAt = timeOf(entry.computedAt);
  if (!entry.preview || computedAt === null) return false;
  if (entry.sourceVersion !== lookup.sourceVersion) return false;
  if (computedAt < lookup.computedNotBefore.getTime()) return false;
  const invalidatedAt = timeOf(entry.invalidatedAt);
  return invalidatedAt === null || computedAt > invalidatedAt;
}

/** Per-workspace upcoming invoice preview cache. */
export class UpcomingInvoicePreviewCacheModel extends BasicDataModel(
  UpcomingInvoicePreviewEntry,
  upcomingInvoicePreviewsTableName,
) {
  async readFresh(
    lookup: PreviewCacheLookup,
  ): Promise<UpcomingInvoicePreview | null> {
    const entry = await this.get(lookup.tenantId);
    return entry && isFresh(entry, lookup) ? entry.preview : null;
  }

  /** Leaves `invalidatedAt` alone: a write racing an invalidation stays stale. */
  async store(write: PreviewCacheWrite): Promise<void> {
    await this.upsert(write.tenantId, {
      preview: write.preview,
      sourceVersion: write.sourceVersion,
      computedAt: write.computedAt,
    });
  }

  async invalidate(tenantId: string, at: Date): Promise<void> {
    await this.upsert(tenantId, { invalidatedAt: at });
  }

  private async upsert(tenantId: string, patch: EntryPatch): Promise<void> {
    if (await this.get(tenantId)) {
      await this.update(tenantId, patch);
      return;
    }
    try {
      await this.insert({ ...EMPTY_ENTRY, ...patch, _id: tenantId });
    } catch (error) {
      if (!(await this.get(tenantId))) throw error;
      await this.update(tenantId, patch);
    }
  }
}
