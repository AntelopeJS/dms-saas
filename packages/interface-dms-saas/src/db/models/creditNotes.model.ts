import type { DeepPartial } from "@antelopejs/interface-database/common";
import { BasicDataModel } from "@antelopejs/interface-database-decorators";
import { CreditNote, creditNotesTableName } from "../tables/creditNotes.table";
import { hasSelectedRow } from "./update-result";

/** Data access for tenant credit notes. */
export class CreditNoteModel extends BasicDataModel(
  CreditNote,
  creditNotesTableName,
) {
  /** Applies a non-terminal update without replacing a void status. */
  async updateUnlessVoided(
    id: string,
    patch: DeepPartial<CreditNote>,
  ): Promise<boolean> {
    const result = await this.table
      .getAll(id)
      .filter((row) => row.key("status").ne("void"))
      .update(patch)
      .run();
    return hasSelectedRow(result);
  }

  /** The credit notes issued against one invoice row, oldest first. */
  async findByInvoice(invoiceId: string): Promise<CreditNote[]> {
    const rows = await this.table
      .getAll(invoiceId, "invoiceId")
      .orderBy("issuedAt")
      .run();
    return rows
      .map((row) => CreditNoteModel.fromDatabase(row))
      .filter((row): row is CreditNote => row !== undefined);
  }

  async findOneByStripeCreditNote(
    stripeCreditNoteId: string,
  ): Promise<CreditNote | undefined> {
    const row = await this.table
      .getAll(stripeCreditNoteId, "stripeCreditNoteId")
      .nth(0)
      .default(undefined)
      .run();
    return row ? CreditNoteModel.fromDatabase(row) : undefined;
  }
}
