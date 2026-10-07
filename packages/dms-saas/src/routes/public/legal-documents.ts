import { Controller, Get } from "@antelopejs/interface-api";
import { GetModel, Model } from "@antelopejs/interface-database-decorators";
import { LegalDocumentsModel } from "../../db";
import {
  ensureLegalDocumentsRow,
  type PublishedLegalDocuments,
  readLegalDocuments,
} from "../../operator-billing";

/** Writes the empty legal documents once, at start. */
export async function ensureLegalDocumentsSingleton(): Promise<void> {
  await ensureLegalDocumentsRow(GetModel(LegalDocumentsModel));
}

/**
 * The published legal documents, readable by anyone: the three texts and,
 * under `versions`, each one's version and publication date. Platform admins
 * save them from the Billing rules & legal page.
 */
export class LegalDocumentsController extends Controller(
  "/api/saas/legal-documents",
) {
  @Model(LegalDocumentsModel)
  declare legalDocumentsModel: LegalDocumentsModel;

  @Get("/")
  get(): Promise<PublishedLegalDocuments> {
    return readLegalDocuments(this.legalDocumentsModel);
  }
}
