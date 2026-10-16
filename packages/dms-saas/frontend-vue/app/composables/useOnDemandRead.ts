import type { MaybeRefOrGetter, Ref } from 'vue'

/** A backend URL to read, or nothing to read while it is null or undefined. */
export type OnDemandUrl = () => string | null | undefined

/** Query parameters of an on-demand read, read again for each request. */
export type OnDemandQuery = MaybeRefOrGetter<Record<string, unknown> | undefined>

export interface OnDemandReadOptions {
	query?: OnDemandQuery
}

export interface OnDemandRead<T> {
	/** The last answer to the current URL, null until one came. */
	data: Readonly<Ref<T | null>>
	pending: Readonly<Ref<boolean>>
	/** Reads the URL now; rejects with the failure. */
	read: () => Promise<T>
}

/** What makes a read wait for `read()`: never on a server, never on its own. */
const ON_DEMAND = {
	immediate: false,
	server: false,
	watch: false,
	refreshOnPageRefresh: false,
} as const

/**
 * A read a component makes when it needs it (a dialog or a drawer opening, a
 * lookup, a preview), through `useApiData` as every read of the module: in
 * the browser only, outside the page's refreshes, and afresh on each `read()`.
 * The URL and the query may change between reads: each `read()` asks for the
 * current ones.
 */
export function useOnDemandRead<T>(
	url: OnDemandUrl,
	options: OnDemandReadOptions = {},
): OnDemandRead<T> {
	const request = useApiData<T>(url, { query: options.query, ...ON_DEMAND })

	async function read(): Promise<T> {
		await request.execute()
		if (request.status.value === 'error') throw request.error.value
		return request.data.value as T
	}

	return { data: request.data, pending: request.pending, read }
}
