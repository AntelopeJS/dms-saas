import { assert } from "@antelopejs/interface-api-util";
import {
  SupportOperationModel,
  supportPublication,
  type SupportOperation,
} from "./operations";
import { reconcileSupportPublication } from "./publications";
import { resumeSupportOperation, type SupportModels } from "./service";

const RECOVERY_PAGE_SIZE = 20;
const HTTP_BAD_REQUEST = 400;
const HTTP_UNAVAILABLE = 503;
const RECEIPT_ID = /^[a-f0-9]{64}$/;

export interface SupportRecoveryPage {
  nextCursor: string | null;
  processed: string[];
  pending: string[];
}

async function recoverOperation(
  tenantId: string,
  models: SupportModels,
  operation: SupportOperation,
): Promise<void> {
  const result = await resumeSupportOperation(tenantId, models, operation);
  assert(
    result.status === "committed" || result.status === "rejected",
    HTTP_UNAVAILABLE,
    "saas.errors.support.operation_pending",
  );
  const ticket = await models.tickets.get(
    supportPublication(operation).ticket._id,
  );
  if (ticket?.publicationId === operation._id)
    await reconcileSupportPublication(models, ticket);
}

/** Scans durable receipts in bounded pages; restart from the beginning for each recovery pass. */
export async function recoverSupportOperations(
  tenantId: string,
  models: SupportModels,
  after = "",
): Promise<SupportRecoveryPage> {
  assert(
    after === "" || RECEIPT_ID.test(after),
    HTTP_BAD_REQUEST,
    "saas.errors.support.invalid_cursor",
  );
  const operations = new SupportOperationModel(models.tickets.database);
  const rows = await operations.table
    .filter((row) => row.key("_id").gt(after))
    .orderBy("_id", "asc")
    .slice(0, RECOVERY_PAGE_SIZE)
    .run();
  const page: SupportRecoveryPage = {
    nextCursor: rows.length === RECOVERY_PAGE_SIZE ? rows.at(-1)!._id : null,
    processed: [],
    pending: [],
  };
  for (const row of rows) {
    try {
      await recoverOperation(tenantId, models, row);
      page.processed.push(row._id);
    } catch {
      page.pending.push(row._id);
    }
  }
  return page;
}
