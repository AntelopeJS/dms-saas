import { h } from 'vue'

type Row = Record<string, unknown> | undefined

interface UserWorkspacesOptions {
	ownedField: string
	memberField: string
}

interface CountChangeOptions {
	changeField: string
	changeLabel?: string
}

const FIGURE_CLASS = 'font-mono text-xs tabular-nums text-highlighted'
const DETAIL_CLASS = 'block text-[11.5px] leading-tight'
const CHANGE_TONES: Record<string, string> = {
	up: 'text-success',
	down: 'text-error',
	flat: 'text-dimmed',
}
const CHANGE_ARROWS: Record<string, string> = { up: '▲', down: '▼', flat: '—' }

function numberField(row: Row, field: string | undefined): number {
	const value = field ? Number(row?.[field]) : Number.NaN
	return Number.isFinite(value) ? value : 0
}

function stacked(figure: string, detail: string, detailClass: string) {
	return h('span', { class: 'flex flex-col items-start' }, [
		h('span', { class: FIGURE_CLASS }, figure),
		h('span', { class: [DETAIL_CLASS, detailClass] }, detail),
	])
}

function changeDirection(change: number): string {
	if (change > 0) return 'up'
	if (change < 0) return 'down'
	return 'flat'
}

export default defineDmsPlugin(() => {
	const { registerDataType } = useDataTypes()
	const nuxtApp = useDmsApp()
	const t = (key: string, params?: Record<string, unknown>, plural?: number) =>
		plural === undefined
			? nuxtApp.$i18n.t(key, params ?? {})
			: nuxtApp.$i18n.t(key, params ?? {}, plural)

	function renderUserWorkspaces(options: unknown, row: Row, locale: string) {
		const opts = options as UserWorkspacesOptions
		const owned = numberField(row, opts.ownedField)
		const member = numberField(row, opts.memberField)
		const total = owned + member
		if (total === 0) {
			return h(
				'span',
				{ class: 'text-dimmed text-xs' },
				t('saas.users.no_workspace'),
			)
		}
		const parts = [
			owned ? t('saas.users.workspaces_owned', { count: owned }, owned) : null,
			member
				? t('saas.users.workspaces_member', { count: member }, member)
				: null,
		].filter(Boolean)
		return stacked(
			new Intl.NumberFormat(locale).format(total),
			parts.join(' · '),
			'text-muted',
		)
	}

	function renderCountChange(
		value: unknown,
		options: unknown,
		row: Row,
		locale: string,
	) {
		const opts = options as CountChangeOptions
		const change = numberField(row, opts.changeField)
		const direction = changeDirection(change)
		const format = new Intl.NumberFormat(locale, { signDisplay: 'exceptZero' })
		const label = opts.changeLabel
			? t(opts.changeLabel.replace(/^\$/, ''), {
					change: format.format(change),
				})
			: format.format(change)
		return stacked(
			new Intl.NumberFormat(locale).format(Number(value) || 0),
			`${CHANGE_ARROWS[direction]} ${label}`,
			CHANGE_TONES[direction] ?? '',
		)
	}

	registerDataType({
		id: 'saas:user-workspaces',
		formatter: {
			default: (_value, locale, options, row) =>
				renderUserWorkspaces(options, row as Row, locale),
			empty: (_value, locale, options, row) =>
				renderUserWorkspaces(options, row as Row, locale),
		},
	})
	registerDataType({
		id: 'saas:count-change',
		formatter: {
			default: (value, locale, options, row) =>
				renderCountChange(value, options, row as Row, locale),
			empty: (value, locale, options, row) =>
				renderCountChange(value, options, row as Row, locale),
		},
	})
})
