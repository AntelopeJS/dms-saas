import {
  Field,
  RegisterTable,
  Table,
  UpdateTime,
} from "@antelopejs/interface-database-decorators";
import { CORE_SCHEMA_NAME } from "@antelopejs/interface-dms/constants";

export const legalDocumentsTableName = "legal_documents";
export const LEGAL_DOCUMENTS_SINGLETON_ID = "singleton";

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

  @UpdateTime()
  @Field("date")
  declare updatedAt: Date;
}
