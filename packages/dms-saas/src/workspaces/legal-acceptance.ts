import { assert } from "@antelopejs/interface-api-util";
import { GetModel } from "@antelopejs/interface-database-decorators";
import { LegalDocumentsModel } from "../db";
import { readLegalDocuments } from "../operator-billing";
import { LegalAcceptanceModel } from "./db/legal-acceptance.model";
import type {
  LegalAcceptance,
  LegalAcceptanceSource,
} from "./db/legal-acceptance.table";

export type { LegalAcceptanceSource } from "./db/legal-acceptance.table";

const HTTP_BAD_REQUEST = 400;

/**
 * Holds a creation to the legal checkbox: the body must say the owner ticked
 * it, as the sign-up screens require before they submit.
 *
 * @param accepted `hasAcceptedLegal` of the body
 * @throws 400 `saas.errors.workspace.legal_acceptance_required` unless `true`
 */
export function assertLegalAccepted(accepted: boolean | undefined): void {
  assert(
    accepted === true,
    HTTP_BAD_REQUEST,
    "saas.errors.workspace.legal_acceptance_required",
  );
}

/**
 * Records that the owner accepted the terms and conditions and the privacy
 * policy when the workspace opened: the versions published at that moment,
 * and the server's time.
 *
 * @param tenantId The workspace the acceptance opened
 * @param userId The owner who ticked the checkbox
 * @param source The screen it was ticked on
 */
export async function recordLegalAcceptance(
  tenantId: string,
  userId: string,
  source: LegalAcceptanceSource,
): Promise<void> {
  const { versions } = await readLegalDocuments(GetModel(LegalDocumentsModel));
  const acceptance: LegalAcceptance = {
    _id: tenantId,
    userId,
    source,
    documents: {
      termsAndConditions: versions.termsAndConditions,
      privacyPolicy: versions.privacyPolicy,
    },
    acceptedAt: new Date(),
  };
  await GetModel(LegalAcceptanceModel).insert([acceptance]);
}

/**
 * Forgets the acceptance of a creation that was rolled back: no workspace
 * opened on it.
 *
 * @param tenantId The workspace that was not created after all
 */
export async function deleteLegalAcceptance(tenantId: string): Promise<void> {
  await GetModel(LegalAcceptanceModel).delete(tenantId);
}
