import {
	computed,
	onMounted,
	shallowRef,
	type ComputedRef,
	type Ref,
} from 'vue'

/** Where a read runs: `server: false` leaves it to the browser. */
export interface ApiReadOptions {
	server?: boolean
}

/**
 * Data a layout strip shows, kept null until the strip is mounted. A strip
 * reads Stripe-backed data with `server: false`, so a slow Stripe never holds
 * the server render of the whole page; the server then renders the strip
 * without it, and the browser's first render must match that HTML, even when
 * the page read the same request on the server and handed its data over.
 */
export function useMountedData<T>(data: Ref<T | null>): ComputedRef<T | null> {
	const isMounted = shallowRef(false)
	onMounted(() => {
		isMounted.value = true
	})
	return computed(() => (isMounted.value ? data.value : null))
}
