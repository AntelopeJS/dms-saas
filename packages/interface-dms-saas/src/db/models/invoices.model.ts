import type { DeepPartial } from "@antelopejs/interface-database/common";
import { BasicDataModel } from "@antelopejs/interface-database-decorators";
import { Invoice, invoicesTableName } from "../tables/invoices.table";
import { hasSelectedRow } from "./update-result";

const STATUS_OPEN = "open";

/** Data access for tenant invoices. */
export class InvoiceModel extends BasicDataModel(Invoice, invoicesTableName) {
  /** Returns invoices, excluding credit notes. */
  async getAllInvoices(): Promise<Invoice[]> {
    const rows = await this.table
      .filter((invoice) => invoice.key("documentType").ne("credit_note"))
      .run();
    return rows
      .map((row) => InvoiceModel.fromDatabase(row))
      .filter((row): row is Invoice => row !== undefined);
  }

  /** Applies a non-terminal update without replacing a void status. */
  async updateUnlessVoided(
    id: string,
    patch: DeepPartial<Invoice>,
  ): Promise<boolean> {
    const result = await this.table
      .getAll(id)
      .filter((row) => row.key("status").ne("void"))
      .update(patch)
      .run();
    return hasSelectedRow(result);
  }

  async findOneByStripeInvoice(
    stripeInvoiceId: string,
  ): Promise<Invoice | undefined> {
    const rows = await this.table
      .getAll(stripeInvoiceId, "stripeInvoiceId")
      .run();
    const row = rows.find((candidate) => !candidate.stripeCreditNoteId);
    return row ? InvoiceModel.fromDatabase(row) : undefined;
  }

  async findOneByStripeCreditNote(
    stripeCreditNoteId: string,
  ): Promise<Invoice | undefined> {
    const row = await this.table
      .getAll(stripeCreditNoteId, "stripeCreditNoteId")
      .nth(0)
      .default(undefined)
      .run();
    return row ? InvoiceModel.fromDatabase(row) : undefined;
  }

  async findLatestOpen(): Promise<Invoice | undefined> {
    const rows = await this.table
      .getAll(STATUS_OPEN, "status")
      .orderBy("issuedAt", "desc")
      .slice(0, 1)
      .run();
    const row = rows[0];
    return row ? InvoiceModel.fromDatabase(row) : undefined;
  }

  async findOpenIssuedBefore(cutoff: Date): Promise<Invoice[]> {
    const rows = await this.table
      .getAll(STATUS_OPEN, "status")
      .filter((row) => row.key("issuedAt").le(cutoff))
      .run();
    return rows
      .map((row) => InvoiceModel.fromDatabase(row))
      .filter((row): row is Invoice => row !== undefined);
  }
}
