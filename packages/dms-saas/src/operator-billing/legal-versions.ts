import {
  LEGAL_DOCUMENT_KEYS,
  type LegalDocumentKey,
  type LegalDocuments,
  type LegalDocumentVersion,
  type LegalDocumentVersions,
} from "../db";

/** The texts of the legal documents, any of them. */
export type LegalDocumentTexts = Partial<Record<LegalDocumentKey, string>>;

/** A stored row, as far as versions are concerned. */
export type VersionedLegalDocuments = Partial<
  Pick<LegalDocuments, LegalDocumentKey | "versions" | "updatedAt">
>;

const NEVER_PUBLISHED: LegalDocumentVersion = {
  version: 0,
  publishedAt: null,
};
const FIRST_VERSION = 1;

/**
 * A document saved before documents were versioned counts as version 1,
 * published when the row was last written; an empty one was never published.
 */
function legacyVersion(
  row: VersionedLegalDocuments,
  key: LegalDocumentKey,
): LegalDocumentVersion {
  if (!row[key]) return NEVER_PUBLISHED;
  return { version: FIRST_VERSION, publishedAt: row.updatedAt ?? null };
}

/**
 * The version and publication date of every document of a row.
 *
 * @param row The stored legal documents, if any
 */
export function readLegalDocumentVersions(
  row: VersionedLegalDocuments | null | undefined,
): LegalDocumentVersions {
  const source = row ?? {};
  return Object.fromEntries(
    LEGAL_DOCUMENT_KEYS.map((key) => [
      key,
      source.versions?.[key] ?? legacyVersion(source, key),
    ]),
  ) as LegalDocumentVersions;
}

function nextVersion(
  current: LegalDocumentVersion,
  text: string,
  now: Date,
): LegalDocumentVersion {
  // An emptied document is withdrawn: its number stays taken, so the text
  // published next is a new version, never a reused one.
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
  return Object.fromEntries(
    LEGAL_DOCUMENT_KEYS.map((key) => {
      const text = texts[key];
      const isChanged = text !== undefined && text !== (row?.[key] ?? "");
      return [
        key,
        isChanged ? nextVersion(current[key], text, now) : current[key],
      ];
    }),
  ) as LegalDocumentVersions;
}
