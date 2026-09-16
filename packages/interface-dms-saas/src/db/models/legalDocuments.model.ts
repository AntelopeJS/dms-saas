import { BasicDataModel } from "@antelopejs/interface-database-decorators";
import {
  LegalDocuments,
  legalDocumentsTableName,
} from "../tables/legalDocuments.table";

/** Data access for platform legal documents. */
export class LegalDocumentsModel extends BasicDataModel(
  LegalDocuments,
  legalDocumentsTableName,
) {}
