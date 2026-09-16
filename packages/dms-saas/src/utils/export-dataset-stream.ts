import { Readable } from "node:stream";
import type { TenantExportArchive } from "@antelopejs/interface-dms/hooks";

/** Rows fetched per round-trip while streaming a dataset into an export. */
export const EXPORT_DATASET_BATCH_SIZE = 200;

const NDJSON_LINE_SEPARATOR = "\n";
const NDJSON_EXTENSION = "jsonl";

/**
 * Paged read of one collection, keyed by primary key.
 *
 * Ids are snapshotted first and rows are then fetched batch by batch: the
 * database interface exposes no cursor, and offset paging would need a stable
 * sort index that not every exported table declares. A fixed id list is stable
 * whatever happens to the table meanwhile, and holds one string per row instead
 * of one document.
 */
export interface ExportDatasetSource<T> {
  listIds(): Promise<string[]>;
  fetchBatch(ids: string[]): Promise<T[]>;
}

export interface ExportStreamOptions {
  batchSize?: number;
  /** Aborted when the export job exceeds its budget. */
  signal?: AbortSignal;
}

export function batchIds(ids: string[], size: number): string[][] {
  const batches: string[][] = [];
  for (let offset = 0; offset < ids.length; offset += size) {
    batches.push(ids.slice(offset, offset + size));
  }
  return batches;
}

/**
 * Serializes a dataset as NDJSON, one document per line. The line format is
 * what makes the export streamable at all: a single JSON array would have to
 * be closed, so the whole dataset would have to be held before the first byte
 * could be written.
 *
 * The abort is checked per batch rather than per dataset: an aborted export
 * would otherwise keep querying the collection it was in the middle of, and a
 * large one holds the job open long past the deadline that cancelled it.
 */
export async function* streamDatasetLines<T>(
  source: ExportDatasetSource<T>,
  options: ExportStreamOptions = {},
): AsyncGenerator<string> {
  const { batchSize = EXPORT_DATASET_BATCH_SIZE, signal } = options;
  signal?.throwIfAborted();
  const ids = await source.listIds();
  for (const batch of batchIds(ids, batchSize)) {
    signal?.throwIfAborted();
    const rows = await source.fetchBatch(batch);
    for (const row of rows) {
      yield `${JSON.stringify(row)}${NDJSON_LINE_SEPARATOR}`;
    }
  }
}

/**
 * Readable over {@link streamDatasetLines}, ready for a `TenantExportArchive`.
 * The archiver pulls it at its own pace, so a batch is fetched only once the
 * previous one has been consumed.
 */
export function createDatasetStream<T>(
  source: ExportDatasetSource<T>,
  options: ExportStreamOptions = {},
): Readable {
  return Readable.from(streamDatasetLines(source, options));
}

export interface ExportDataset<T> {
  /** Entry name, below the contributor's own archive namespace. */
  entry: string;
  source: ExportDatasetSource<T>;
}

/**
 * Writes each dataset as its own NDJSON archive entry, one at a time: the
 * archiver holds a single zip stream, so two entries appended concurrently
 * would interleave.
 */
export async function writeDatasetsToArchive<T>(
  archive: Pick<TenantExportArchive, "addStream">,
  datasets: readonly ExportDataset<T>[],
  options: ExportStreamOptions = {},
): Promise<void> {
  for (const dataset of datasets) {
    options.signal?.throwIfAborted();
    await archive.addStream(
      `${dataset.entry}.${NDJSON_EXTENSION}`,
      createDatasetStream(dataset.source, options),
    );
  }
}
