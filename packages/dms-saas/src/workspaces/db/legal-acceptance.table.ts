import {
  Field,
  RegisterTable,
  Table,
} from "@antelopejs/interface-database-decorators";
import { CORE_SCHEMA_NAME } from "@antelopejs/interface-dms/constants";
import type { LegalDocumentVersion } from "../../db";

export const legalAcceptancesTableName = "saas_legal_acceptances";

/** The screen the owner accepted the legal documents on. */
export type LegalAcceptanceSource = "registration" | "workspace_creation";

/** The documents the acceptance checkbox names, at the versions it named. */
export type AcceptedLegalDocuments = Record<
  "termsAndConditions" | "privacyPolicy",
  LegalDocumentVersion
>;

/**
 * The acceptance of the terms and conditions and the privacy policy that
 * opened a workspace: one row per workspace, keyed by its tenant id, written
 * by sign-up and by the Create workspace form alike. A workspace an operator
 * opens for a customer has none. The row outlives the workspace: it is the
 * record that its owner accepted.
 */
@RegisterTable(legalAcceptancesTableName, CORE_SCHEMA_NAME)
export class LegalAcceptance extends Table {
  /** The workspace's tenant id. */
  @Field("string")
  declare _id: string;

  /** Who ticked the checkbox: the workspace's first owner. */
  @Field("string")
  declare userId: string;

  @Field("string")
  declare source: LegalAcceptanceSource;

  /** The versions published when the checkbox was ticked. */
  @Field("any")
  declare documents: AcceptedLegalDocuments;

  /** The server's time when the creation was accepted. */
  @Field("date")
  declare acceptedAt: Date;
}
