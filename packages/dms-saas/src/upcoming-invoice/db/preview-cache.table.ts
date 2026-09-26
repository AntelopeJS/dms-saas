import {
  Field,
  RegisterTable,
  Table,
} from "@antelopejs/interface-database-decorators";
import { CORE_SCHEMA_NAME } from "@antelopejs/interface-dms/constants";
import type { UpcomingInvoicePreview } from "@antelopejs/interface-dms-saas/billing";

export const upcomingInvoicePreviewsTableName =
  "saas_upcoming_invoice_previews";

/**
 * Last upcoming invoice preview of a workspace, keyed by tenant id. Kept in the
 * database rather than in memory so an invalidation received by one instance
 * reaches every other.
 */
@RegisterTable(upcomingInvoicePreviewsTableName, CORE_SCHEMA_NAME)
export class UpcomingInvoicePreviewEntry extends Table {
  @Field("string")
  declare _id: string;

  @Field("any")
  declare preview: UpcomingInvoicePreview | null;

  /** Local billing state the preview was computed from. */
  @Field("string")
  declare sourceVersion: string | null;

  /** When the computation started, so a later invalidation always wins. */
  @Field("date")
  declare computedAt: Date | null;

  @Field("date")
  declare invalidatedAt: Date | null;
}
