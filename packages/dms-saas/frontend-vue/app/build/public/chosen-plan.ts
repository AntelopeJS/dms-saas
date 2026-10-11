const CHOSEN_PLAN_STORAGE_KEY = 'dms-saas-chosen-plan'

function sessionStore(): Storage | null {
	try {
		return typeof window === 'undefined' ? null : window.sessionStorage
	} catch {
		return null
	}
}

/**
 * Keeps the plan chosen on Pricing across the OAuth round-trip: the provider
 * sends the visitor back to "Set up your first workspace", which has no
 * `?plan=` of its own.
 *
 * @param reference Slug or id of the chosen plan; null forgets it
 */
export function rememberChosenPlan(reference: string | null): void {
	const store = sessionStore()
	if (!store) return
	try {
		if (reference) store.setItem(CHOSEN_PLAN_STORAGE_KEY, reference)
		else store.removeItem(CHOSEN_PLAN_STORAGE_KEY)
	} catch {
		/* storage full or refused: the visitor picks the plan again on Billing */
	}
}

/** The plan chosen on Pricing earlier in this tab, if any. */
export function readChosenPlan(): string | null {
	try {
		return sessionStore()?.getItem(CHOSEN_PLAN_STORAGE_KEY) ?? null
	} catch {
		return null
	}
}
