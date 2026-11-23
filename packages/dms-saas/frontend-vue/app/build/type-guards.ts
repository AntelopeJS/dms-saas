/** Whether the value is a non-null object, its keys still unread. */
export function isObject(value: unknown): value is object {
	return typeof value === 'object' && value !== null
}

/** Whether the value is a non-null object whose keys can be read. */
export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null
}

/** Whether the value is a string. */
export function isText(value: unknown): value is string {
	return typeof value === 'string'
}

/** Whether the value is a number. */
export function isNumber(value: unknown): value is number {
	return typeof value === 'number'
}
