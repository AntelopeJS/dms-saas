import {
  type DataModel,
  GetModel,
} from "@antelopejs/interface-database-decorators";
import type { TenantExportArchive } from "@antelopejs/interface-dms/hooks";
import {
  type CreditNote,
  CreditNoteModel,
  type Invoice,
  InvoiceModel,
  type Refund,
  RefundModel,
} from "../db";
import {
  type ExportDataset,
  type ExportDatasetSource,
  writeDatasetsToArchive,
} from "../utils/export-dataset-stream";

interface ExportedRow {
  _id: string;
}

interface SaasExportDataset {
  entry: string;
  createSource: (tenantId: string) => ExportDatasetSource<ExportedRow>;
}

function createDatasetSource<T extends ExportedRow>(
  model: DataModel<T>,
  tenantId: string,
): ExportDatasetSource<T> {
  const instance = GetModel(model, tenantId);
  return {
    async listIds(): Promise<string[]> {
      const rows = await instance.table.pluck("_id").run();
      return rows
        .map((row) => row._id)
        .filter((id): id is string => id !== undefined);
    },
    async fetchBatch(ids: string[]): Promise<T[]> {
      const rows = await instance.table.getAll(ids).run();
      return rows
        .map((row) => model.fromDatabase(row))
        .filter((row): row is T => row !== undefined);
    },
  };
}

function createInvoiceDatasetSource(
  tenantId: string,
): ExportDatasetSource<Invoice> {
  const model = GetModel(InvoiceModel, tenantId);
  return {
    async listIds(): Promise<string[]> {
      return (await model.getAllInvoices()).map((invoice) => invoice._id);
    },
    async fetchBatch(ids: string[]): Promise<Invoice[]> {
      const rows = await model.table.getAll(ids).run();
      return rows
        .map((row) => InvoiceModel.fromDatabase(row))
        .filter((row): row is Invoice => row !== undefined);
    },
  };
}

const DATASETS: SaasExportDataset[] = [
  {
    entry: "invoices",
    createSource: createInvoiceDatasetSource,
  },
  {
    entry: "credit-notes",
    createSource: (tenantId) =>
      createDatasetSource<CreditNote>(CreditNoteModel, tenantId),
  },
  {
    entry: "refunds",
    createSource: (tenantId) =>
      createDatasetSource<Refund>(RefundModel, tenantId),
  },
];

function buildDatasets(tenantId: string): ExportDataset<ExportedRow>[] {
  return DATASETS.map((dataset) => ({
    entry: dataset.entry,
    source: dataset.createSource(tenantId),
  }));
}

/**
 * Writes the workspace's billing history into the export archive, one NDJSON
 * entry per collection.
 *
 * Nothing is returned: a `TenantDataExportContribution` is serialized whole by
 * the archiver, which is what this contributor used to hand over and what
 * stops the export from scaling. Streaming instead keeps memory flat whatever
 * the workspace holds, and is the contract the volume dumps of the cloud
 * module need.
 */
export async function exportSaasTenantData(
  tenantId: string,
  archive: TenantExportArchive,
  signal: AbortSignal,
): Promise<void> {
  // A dms-base predating the archive sink calls contributors with the tenant
  // id alone. Failing on the contract rather than on a member of `undefined`
  // is what keeps that mismatch readable in the archive manifest.
  if (!archive) {
    throw new Error(
      "Tenant data export requires a dms-base providing the export archive sink",
    );
  }
  await writeDatasetsToArchive(archive, buildDatasets(tenantId), { signal });
}
