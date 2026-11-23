import { isRecord } from './type-guards'

/** A failed `$authFetch`, which carries the server's answer as `data`. */
export interface ApiFailure {
	data?: unknown
}

/** Whether a caught value can carry the server's answer. */
export function isApiFailure(value: unknown): value is ApiFailure {
	return isRecord(value)
}
