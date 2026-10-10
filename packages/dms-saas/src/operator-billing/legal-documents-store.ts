import {
  LEGAL_DOCUMENTS_SINGLETON_ID,
  type LegalDocuments,
  type LegalDocumentsModel,
  type LegalDocumentVersions,
} from "../db";
import {
  bumpLegalDocumentVersions,
  type LegalDocumentTexts,
  readLegalDocumentVersions,
} from "./legal-versions";

/** The legal documents as they are read: the texts and their versions. */
export interface PublishedLegalDocuments {
  termsOfUse: string;
  termsAndConditions: string;
  privacyPolicy: string;
  versions: LegalDocumentVersions;
  updatedAt: Date | null;
}

function emptyDocuments(now: Date): LegalDocuments {
  return {
    _id: LEGAL_DOCUMENTS_SINGLETON_ID,
    termsOfUse: "",
    termsAndConditions: "",
    privacyPolicy: "",
    versions: readLegalDocumentVersions(null),
    updatedAt: now,
  } as LegalDocuments;
}

/**
 * Writes the empty documents once, so the row exists before anyone saves.
 *
 * @param model The legal documents model
 */
export async function ensureLegalDocumentsRow(
  model: LegalDocumentsModel,
): Promise<void> {
  const existing = await model.get(LEGAL_DOCUMENTS_SINGLETON_ID);
  if (existing) return;
  await model.insert([emptyDocuments(new Date())]);
}

/**
 * The texts and versions of the legal documents; empty, never published,
 * before the row exists.
 *
 * @param model The legal documents model
 */
export async function readLegalDocuments(
  model: LegalDocumentsModel,
): Promise<PublishedLegalDocuments> {
  const row = await model.get(LEGAL_DOCUMENTS_SINGLETON_ID);
  return {
    termsOfUse: row?.termsOfUse ?? "",
    termsAndConditions: row?.termsAndConditions ?? "",
    privacyPolicy: row?.privacyPolicy ?? "",
    versions: readLegalDocumentVersions(row),
    updatedAt: row?.updatedAt ?? null,
  };
}

/**
 * Saves the texts given, publishing each changed document as its next version.
 * Nothing is written when no text changed.
 *
 * @param model The legal documents model
 * @param texts The texts to save; a document left out is unchanged
 * @param now When the save happens
 */
export async function saveLegalDocuments(
  model: LegalDocumentsModel,
  texts: LegalDocumentTexts,
  now: Date,
): Promise<void> {
  await ensureLegalDocumentsRow(model);
  const row = await model.get(LEGAL_DOCUMENTS_SINGLETON_ID);
  const changed = Object.fromEntries(
    Object.entries(texts).filter(
      ([key, text]) => text !== row?.[key as keyof LegalDocumentTexts],
    ),
  ) as LegalDocumentTexts;
  if (Object.keys(changed).length === 0) return;
  await model.update(LEGAL_DOCUMENTS_SINGLETON_ID, {
    ...changed,
    versions: bumpLegalDocumentVersions(row, changed, now),
    updatedAt: now,
  });
}
