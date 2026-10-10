import { isInAppPath, LOGIN_PATH, type LegalDocumentField } from './routes'

/** Version of one document, as Billing rules & legal publishes it. */
export interface LegalDocumentVersion {
	version: number
	publishedAt: string
}

/**
 * `GET /api/saas/legal-documents`. `versions` comes with the versioned
 * documents; a backend without them still answers the texts and one date.
 */
export interface LegalDocumentsPayload {
	termsOfUse?: string
	termsAndConditions?: string
	privacyPolicy?: string
	updatedAt?: string | null
	versions?: Partial<Record<LegalDocumentField, LegalDocumentVersion>>
}

export interface LegalDocumentStamp {
	version: number | null
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
/** The epoch is what an empty singleton reports before anything is saved. */
const NEVER_SAVED = 0

function isMeaningfulDate(value: string | null | undefined): value is string {
	if (!value) return false
	const time = new Date(value).getTime()
	return Number.isFinite(time) && time > NEVER_SAVED
}

/**
 * Version and last update of one document: its own publication when the
 * backend versions documents, else the date the texts were last saved.
 *
 * @param payload Legal documents payload
 * @param field Document to stamp
 */
export function legalDocumentStamp(
	payload: LegalDocumentsPayload,
	field: LegalDocumentField,
): LegalDocumentStamp {
	const published = payload.versions?.[field]
	if (published) {
		return {
			version: published.version,
			updatedAt: isMeaningfulDate(published.publishedAt)
				? published.publishedAt
				: null,
		}
	}
	return {
		version: null,
		updatedAt: isMeaningfulDate(payload.updatedAt) ? payload.updatedAt : null,
	}
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
