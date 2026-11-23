import { isRecord, isText } from '../build/type-guards'
/** A failed `$authFetch`, which carries the server's answer as `data`. */
export interface ApiFailure {
	data?: unknown
}

/** Whether a caught value can carry the server's answer. */
export function isApiFailure(value: unknown): value is ApiFailure {
	return isRecord(value)
}

function readKey(data: unknown): string | undefined {
	if (isText(data)) return data
	if (isRecord(data)) return isText(data.message) ? data.message : undefined
	return undefined
}

/** The i18n key the server answered a failed `$authFetch` with, if any. */
export function readApiErrorKey(error: unknown): string | undefined {
	return isApiFailure(error) ? readKey(error.data) : undefined
}
