import { BasicDataModel } from "@antelopejs/interface-database-decorators";
import {
  LegalAcceptance,
  legalAcceptancesTableName,
} from "./legal-acceptance.table";

/** Reads and writes the acceptance that opened each workspace. */
export class LegalAcceptanceModel extends BasicDataModel(
  LegalAcceptance,
  legalAcceptancesTableName,
) {}
