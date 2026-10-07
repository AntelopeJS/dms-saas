import { h, type VNode } from 'vue'
import { formatMinorUnits } from '../composables/useMoneyFormat'
import { saasStatusTone, type SaasTone } from '../composables/useSaasStatus'

/** The directory row a workspace cell reads its sibling fields from. */
interface WorkspaceRow {
	billingState?: string
	planName?: string | null
	planUnitAmountMinor?: number | null
	planInterval?: string | null
	planBillingMode?: string | null
	currency?: string | null
	seats?: number
	isComplimentary?: boolean
	mrrMinor?: number
	ownerName?: string | null
	ownerEmail?: string | null
	ownerStatus?: string
	renewalKind?: string | null
	renewsAt?: string | null
}

interface CellOptions {
	kind?: CellKind
}

type CellKind = 'plan' | 'mrr' | 'owner' | 'renewal'

/** The two lines of a cell: the value, and what it means. */
interface CellLines {
	main: string
	sub?: string
	subTone?: SaasTone
}

type Translate = (
	key: string,
	params?: Record<string, unknown>,
	plural?: number,
) => string

const K = 'saas.workspaces'
const EMPTY = '—'
const MS_PER_DAY = 86_400_000
const YEARLY = 'year'
const MONTHS_PER_YEAR = 12
const DAY_FORMAT: Intl.DateTimeFormatOptions = { dateStyle: 'medium' }

const TONE_CLASSES: Record<SaasTone, string> = {
	neutral: 'text-muted',
	primary: 'text-primary',
	secondary: 'text-secondary',
	success: 'text-success',
	warning: 'text-warning',
	error: 'text-error',
	info: 'text-info',
}

// What MRR means beside the amount: what a trial will bill, what is at risk,
// what a suspension stopped. Other states need no note.
const MRR_NOTES: Record<string, { key: string; tone: SaasTone }> = {
	past_due: { key: 'at_risk', tone: 'error' },
	suspended: { key: 'billing_paused', tone: 'neutral' },
}

function money(row: WorkspaceRow, amountMinor: number, locale: string): string {
	return formatMinorUnits(amountMinor, row.currency ?? null, locale)
}

/** What a trial bills per month once it converts, as the server normalises it. */
function monthlyAfterTrial(row: WorkspaceRow): number {
	const seats = row.planBillingMode === 'seat' ? Math.max(1, row.seats ?? 0) : 1
	const months = row.planInterval === YEARLY ? MONTHS_PER_YEAR : 1
	return Math.round(((row.planUnitAmountMinor ?? 0) * seats) / months)
}

function planLines(row: WorkspaceRow, t: Translate, locale: string): CellLines {
	if (!row.planName) return { main: EMPTY }
	if (row.isComplimentary)
		return { main: row.planName, sub: t(`${K}.plan_cell.complimentary`) }
	const price = money(row, row.planUnitAmountMinor ?? 0, locale)
	const interval = t(`${K}.interval.${row.planInterval ?? 'month'}`)
	const sub =
		row.planBillingMode === 'seat'
			? t(`${K}.plan_cell.price_times_seats`, {
					price,
					seats: row.seats ?? 0,
					interval,
				})
			: t(`${K}.plan_cell.price_flat`, { price, interval })
	return { main: row.planName, sub }
}

function mrrLines(row: WorkspaceRow, t: Translate, locale: string): CellLines {
	const state = row.billingState ?? ''
	if (!row.currency || state === 'pending_payment' || state === 'cancelled')
		return { main: EMPTY }
	const main = money(row, row.mrrMinor ?? 0, locale)
	const note = MRR_NOTES[state]
	if (note)
		return { main, sub: t(`${K}.mrr_cell.${note.key}`), subTone: note.tone }
	if (state === 'trialing')
		return {
			main,
			sub: t(`${K}.mrr_cell.trial`, {
				amount: money(row, monthlyAfterTrial(row), locale),
			}),
		}
	if (row.planInterval === YEARLY && (row.mrrMinor ?? 0) > 0)
		return { main, sub: t(`${K}.mrr_cell.yearly`) }
	return { main }
}

function ownerLines(row: WorkspaceRow, t: Translate): CellLines {
	const status = row.ownerStatus ?? 'none'
	return {
		main: row.ownerName || row.ownerEmail || EMPTY,
		sub: t(`saas.status.owner.${status}`),
		subTone: saasStatusTone('owner', status),
	}
}

function daysUntil(date: Date): number {
	return Math.max(0, Math.ceil((date.getTime() - Date.now()) / MS_PER_DAY))
}

function renewalLines(
	row: WorkspaceRow,
	t: Translate,
	locale: string,
): CellLines {
	if (!row.renewalKind || !row.renewsAt) return { main: EMPTY }
	const date = new Date(row.renewsAt)
	const days = daysUntil(date)
	return {
		main: t(`${K}.renewal.${row.renewalKind}`, { days }, days),
		sub: new Intl.DateTimeFormat(locale, DAY_FORMAT).format(date),
		subTone: row.renewalKind === 'suspends' ? 'error' : undefined,
	}
}

const LINES: Record<
	CellKind,
	(row: WorkspaceRow, t: Translate, locale: string) => CellLines
> = {
	plan: planLines,
	mrr: mrrLines,
	owner: (row, t) => ownerLines(row, t),
	renewal: renewalLines,
}

function renderLines(lines: CellLines): VNode {
	return h('div', { class: 'min-w-0 leading-tight' }, [
		h('div', { class: 'truncate font-medium text-highlighted' }, lines.main),
		lines.sub
			? h(
					'div',
					{
						class: [
							'truncate text-xs',
							TONE_CLASSES[lines.subTone ?? 'neutral'],
						],
					},
					lines.sub,
				)
			: null,
	])
}

/**
 * The two-line cells of the workspace directory (`saas:workspace_cell`):
 * each composes sibling fields of the row the server denormalised.
 */
export default defineDmsPlugin(() => {
	const { registerDataType } = useDataTypes()
	const nuxtApp = useDmsApp()
	const t: Translate = (key, params, plural) =>
		plural === undefined
			? nuxtApp.$i18n.t(key, params ?? {})
			: nuxtApp.$i18n.t(key, params ?? {}, plural as number)
	// Also for an empty value: the owner of a workspace whose owner never
	// joined has no name, and the cell reads the invitation instead.
	const formatCell = (
		_value: unknown,
		locale: string,
		options?: unknown,
		row?: unknown,
	) => {
		const kind = (options as CellOptions | undefined)?.kind ?? 'plan'
		return renderLines(LINES[kind]((row ?? {}) as WorkspaceRow, t, locale))
	}
	registerDataType({
		id: 'saas:workspace_cell',
		formatter: { default: formatCell, empty: formatCell },
	})
})
