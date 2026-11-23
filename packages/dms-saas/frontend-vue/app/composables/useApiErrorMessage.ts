import { isApiFailure } from '../build/api-failure'
import { isRecord, isText } from '../build/type-guards'
function readKey(data: unknown): string | undefined {
	if (isText(data)) return data
	if (isRecord(data)) return isText(data.message) ? data.message : undefined
	return undefined
}

/** The i18n key the server answered a failed `$authFetch` with, if any. */
export function readApiErrorKey(error: unknown): string | undefined {
	return isApiFailure(error) ? readKey(error.data) : undefined
}
