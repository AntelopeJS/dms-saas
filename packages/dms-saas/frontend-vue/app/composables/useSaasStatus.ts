/** The DMS's semantic tones (`Tone` of dms-ui), restated so tests can import this file. */
export type SaasTone =
	| 'neutral'
	| 'primary'
	| 'secondary'
	| 'success'
	| 'warning'
	| 'error'
	| 'info'

/**
 * One colour per status across the module, mirrored from the backend's
 * `STATUS_TONES` (src/utils/status-vocabulary.ts); a test keeps them equal.
 */
export const SAAS_STATUS_TONES = {
	workspace: {
		active: 'success',
		trialing: 'info',
		free: 'primary',
		past_due: 'error',
		pending_payment: 'warning',
		suspended: 'error',
		cancelled: 'neutral',
	},
	invoice: {
		draft: 'neutral',
		open: 'warning',
		paid: 'success',
		void: 'neutral',
		uncollectible: 'error',
		issued: 'success',
	},
	credit_note: {
		issued: 'success',
		void: 'neutral',
	},
	credit_note_type: {
		pre_payment: 'neutral',
		post_payment: 'neutral',
		credit_to_balance: 'primary',
		refund: 'info',
		mixed: 'neutral',
	},
	migration: {
		pending: 'neutral',
		running: 'info',
		completed: 'success',
		failed: 'error',
		partially_failed: 'warning',
		reconciliation_required: 'error',
	},
	owner: {
		joined: 'success',
		invited: 'warning',
		expired: 'error',
		none: 'neutral',
	},
} as const satisfies Record<string, Record<string, SaasTone>>

export type SaasStatusFamily = keyof typeof SAAS_STATUS_TONES

export interface SaasStatusView {
	label: string
	tone: SaasTone
}

const FALLBACK_TONE: SaasTone = 'neutral'

/** The tone of a status, neutral for a value the family does not know. */
function saasStatusTone(
	family: SaasStatusFamily,
	status: string | null | undefined,
): SaasTone {
	const tones: Record<string, SaasTone> = SAAS_STATUS_TONES[family]
	return (status && tones[status]) || FALLBACK_TONE
}

/** Label and tone of any status, for `DmsStatusPill` and friends. */
export function useSaasStatus() {
	const { t } = useI18n()
	return {
		statusView: (
			family: SaasStatusFamily,
			status: string | null | undefined,
		): SaasStatusView => ({
			label: status ? t(`saas.status.${family}.${status}`) : '—',
			tone: saasStatusTone(family, status),
		}),
	}
}
