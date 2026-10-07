import {
  Field,
  RegisterTable,
  Table,
  UpdateTime,
} from "@antelopejs/interface-database-decorators";
import { CORE_SCHEMA_NAME } from "@antelopejs/interface-dms/constants";

export const legalDocumentsTableName = "legal_documents";
export const LEGAL_DOCUMENTS_SINGLETON_ID = "singleton";

/** The legal documents the platform publishes, by their field on the row. */
export const LEGAL_DOCUMENT_KEYS = [
  "termsOfUse",
  "termsAndConditions",
  "privacyPolicy",
] as const;

export type LegalDocumentKey = (typeof LEGAL_DOCUMENT_KEYS)[number];

/**
 * The published version of one legal document: `version` counts the times its
 * text changed (0 while it was never published), `publishedAt` is when the
 * current text went out (null for a document never published).
 */
export interface LegalDocumentVersion {
  version: number;
  publishedAt: Date | null;
}

export type LegalDocumentVersions = Record<
  LegalDocumentKey,
  LegalDocumentVersion
>;

/** Platform legal documents displayed during SaaS flows. */
@RegisterTable(legalDocumentsTableName, CORE_SCHEMA_NAME)
export class LegalDocuments extends Table {
  @Field("string")
  declare _id: string;

  @Field("string")
  declare termsOfUse: string;

  @Field("string")
  declare termsAndConditions: string;

  @Field("string")
  declare privacyPolicy: string;

  /**
   * Version and publication date of each document. Rows written before the
   * documents were versioned lack it, or lack a document's entry.
   */
  @Field("any")
  declare versions?: Partial<LegalDocumentVersions>;

  @UpdateTime()
  @Field("date")
  declare updatedAt: Date;
}
