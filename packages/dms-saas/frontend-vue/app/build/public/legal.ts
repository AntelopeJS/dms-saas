import { isInAppPath, LOGIN_PATH, type LegalDocumentField } from './routes'

/**
 * Version of one document, as Billing rules & legal publishes it: version 0
 * and no date while it was never published.
 */
export interface LegalDocumentVersion {
	version: number
	publishedAt: string | null
}

/** `GET /api/saas/legal-documents`. */
export interface LegalDocumentsPayload {
	termsOfUse: string
	termsAndConditions: string
	privacyPolicy: string
	versions: Record<LegalDocumentField, LegalDocumentVersion>
}

export interface LegalDocumentStamp {
	version: number
	updatedAt: string | null
}

export interface LegalHeading {
	id: string
	text: string
	level: number
}

const WORDS_PER_MINUTE = 200
const HEADING_ID_PREFIX = 'section-'
const NON_SLUG_CHARACTERS = /[^\p{Letter}\p{Number}]+/gu
const EDGE_DASHES = /^-+|-+$/g
const WORD_SEPARATOR = /\s+/
/**
 * Version and publication date of one document.
 *
 * @param payload Legal documents payload
 * @param field Document to stamp
 */
export function legalDocumentStamp(
	payload: LegalDocumentsPayload,
	field: LegalDocumentField,
): LegalDocumentStamp {
	const published = payload.versions[field]
	return { version: published.version, updatedAt: published.publishedAt }
}

/**
 * A unique anchor id for a heading, readable in the address bar.
 *
 * @param text Heading text
 * @param taken Ids already given in this document; the new one is added
 */
export function headingAnchor(text: string, taken: Set<string>): string {
	const base =
		text
			.toLowerCase()
			.replace(NON_SLUG_CHARACTERS, '-')
			.replace(EDGE_DASHES, '') || String(taken.size + 1)
	let id = `${HEADING_ID_PREFIX}${base}`
	for (let suffix = 2; taken.has(id); suffix++) {
		id = `${HEADING_ID_PREFIX}${base}-${suffix}`
	}
	taken.add(id)
	return id
}

/** Minutes a document takes to read, never less than one. */
export function readingMinutes(text: string): number {
	const words = text.trim().split(WORD_SEPARATOR).filter(Boolean).length
	return Math.max(1, Math.ceil(words / WORDS_PER_MINUTE))
}

/**
 * Where "Back" leads: the page named by `?from=`, else the page of this site
 * the visitor followed the link from, else sign-in.
 *
 * @param from `from` query parameter
 * @param referrer `document.referrer`
 * @param origin This site's origin
 * @param currentPath Path of the legal page itself
 */
export function resolveLegalBackTarget(
	from: unknown,
	referrer: string,
	origin: string,
	currentPath: string,
): string {
	if (isInAppPath(from)) return from
	try {
		const url = new URL(referrer)
		const isSameSite = url.origin === origin && url.pathname !== currentPath
		return isSameSite ? `${url.pathname}${url.search}` : LOGIN_PATH
	} catch {
		return LOGIN_PATH
	}
}
