import {
  type LegalDocumentKey,
  type LegalDocuments,
  type LegalDocumentVersion,
  type LegalDocumentVersions,
} from "../db";

/** The texts of the legal documents, any of them. */
export type LegalDocumentTexts = Partial<Record<LegalDocumentKey, string>>;

/** A stored row, as far as versions are concerned. */
export type VersionedLegalDocuments = Pick<
  LegalDocuments,
  LegalDocumentKey | "versions"
>;

const NEVER_PUBLISHED: LegalDocumentVersion = {
  version: 0,
  publishedAt: null,
};

/**
 * The version and publication date of every document of a row; every
 * document is unpublished before the row exists.
 *
 * @param row The stored legal documents, if any
 */
export function readLegalDocumentVersions(
  row: VersionedLegalDocuments | null | undefined,
): LegalDocumentVersions {
  if (row) return row.versions;
  return {
    termsOfUse: NEVER_PUBLISHED,
    termsAndConditions: NEVER_PUBLISHED,
    privacyPolicy: NEVER_PUBLISHED,
  };
}

/**
 * The version after saving `text`. An emptied document is withdrawn: its number
 * stays taken, so the text published next is a new version, never a reused one.
 */
function nextVersion(
  current: LegalDocumentVersion,
  text: string,
  now: Date,
): LegalDocumentVersion {
  if (!text) return { version: current.version, publishedAt: null };
  return { version: current.version + 1, publishedAt: now };
}

/**
 * The versions once `texts` are saved: a document whose text changed gets the
 * next version, published `now`; an emptied one is unpublished.
 *
 * @param row The stored legal documents, if any
 * @param texts The texts being saved; a document left out is unchanged
 * @param now When the save happens
 */
export function bumpLegalDocumentVersions(
  row: VersionedLegalDocuments | null | undefined,
  texts: LegalDocumentTexts,
  now: Date,
): LegalDocumentVersions {
  const current = readLegalDocumentVersions(row);
  const bump = (key: LegalDocumentKey): LegalDocumentVersion => {
    const text = texts[key];
    const isChanged = text !== undefined && text !== (row?.[key] ?? "");
    return isChanged ? nextVersion(current[key], text, now) : current[key];
  };
  return {
    termsOfUse: bump("termsOfUse"),
    termsAndConditions: bump("termsAndConditions"),
    privacyPolicy: bump("privacyPolicy"),
  };
}
