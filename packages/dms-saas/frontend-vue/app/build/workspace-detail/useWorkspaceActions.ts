import { useApiErrorMessage } from '../../composables/useApiErrorMessage'
import { useDetailRefresh } from '../../composables/useDetailRefresh'
import { formatMinorUnits } from '../../composables/useMoneyFormat'
import type { SuspensionImpact } from './types'

const D = 'saas.workspace_detail'

/** One line of what a confirmed action changes. */
interface ImpactEntry {
	icon: string
	label: string
}

/** The join confirmation the server words for the workspace. */
interface JoinConfirmation {
	title: string
	description?: string
	params?: Record<string, unknown>
	icon?: string
	color?: 'primary'
	confirmLabel?: string
	impact?: ImpactEntry[]
	blocked?: boolean
}

/**
 * The operator actions confirmed in the DMS's own dialog: join as platform
 * support, suspend (impact listed, workspace name typed) and reactivate.
 * Each refreshes the page's blocks once it succeeded; a dialog that cannot be
 * prepared says so instead of opening empty.
 */
export function useWorkspaceActions(tenantId: string) {
	const { $authFetch } = useAuthFetch()
	const { t, locale } = useI18n()
	const { confirm } = useConfirm()
	const toast = useToast()
	const { resolveApiError } = useApiErrorMessage()
	const { trigger } = useDetailRefresh(tenantId)
	const base = `/api/saas/workspaces/${tenantId}`

	function translate(
		text: string | undefined,
		params: Record<string, unknown>,
	) {
		if (!text) return undefined
		return text.startsWith('$') ? t(text.slice(1), params) : text
	}

	function day(value: string): string {
		return formatDate(value, locale.value, { dateStyle: 'medium' }) ?? value
	}

	function money(amountMinor: number, currency: string): string {
		return formatMinorUnits(amountMinor, currency, locale.value)
	}

	/** Runs an action, reporting a dialog that could not be prepared. */
	async function guarded(action: () => Promise<boolean>, successKey: string) {
		try {
			if (!(await action())) return
			toast.add({
				title: t(successKey),
				color: 'success',
				icon: 'i-ph-check-circle',
			})
			trigger()
		} catch (error) {
			toast.add({
				title: resolveApiError(error, `${D}.error.prepare`),
				color: 'error',
				icon: 'i-ph-warning-circle',
			})
		}
	}

	async function confirmJoin(): Promise<boolean> {
		const dialog = await $authFetch<JoinConfirmation>(
			`${base}/join-confirmation`,
		)
		const params = dialog.params ?? {}
		return confirm({
			title: translate(dialog.title, params) ?? '',
			description: translate(dialog.description, params),
			icon: dialog.icon,
			color: dialog.color,
			blocked: dialog.blocked,
			confirmLabel: translate(dialog.confirmLabel, params),
			impact: dialog.impact?.map((entry) => ({
				icon: entry.icon,
				label: translate(entry.label, params) ?? '',
			})),
			onConfirm: async () => {
				await $authFetch(`${base}/join`, { method: 'POST' })
			},
		})
	}

	function suspensionImpact(impact: SuspensionImpact): ImpactEntry[] {
		const invoice = impact.nextInvoice
		const owner = impact.owner?.name || impact.owner?.email
		const entries: Array<ImpactEntry | null> = [
			{
				icon: 'i-ph-users',
				label: t(
					`${D}.suspend.impact_members`,
					{ count: impact.members },
					impact.members,
				),
			},
			impact.stripeSubscriptionId
				? {
						icon: 'i-ph-pause-circle',
						label: t(`${D}.suspend.impact_subscription`, {
							id: impact.stripeSubscriptionId,
						}),
					}
				: null,
			invoice
				? {
						icon: 'i-ph-receipt',
						label: t(`${D}.suspend.impact_invoice`, {
							date: day(invoice.date),
							amount: money(invoice.amountMinor, invoice.currency),
						}),
					}
				: null,
			owner
				? {
						icon: 'i-ph-envelope-simple',
						label: t(`${D}.suspend.impact_owner`, { owner }),
					}
				: null,
		]
		return entries.filter((entry): entry is ImpactEntry => entry !== null)
	}

	async function confirmSuspend(): Promise<boolean> {
		const impact = await $authFetch<SuspensionImpact>(
			`${base}/suspension-impact`,
		)
		const operationId = crypto.randomUUID()
		return confirm({
			title: t(`${D}.suspend.title`, { name: impact.workspaceName }),
			description: t(`${D}.suspend.description`),
			icon: 'i-ph-prohibit',
			color: 'error',
			confirmLabel: t(`${D}.suspend.confirm`),
			impact: suspensionImpact(impact),
			confirmText: impact.workspaceName,
			initialFocus: 'cancel',
			onConfirm: async () => {
				await $authFetch(`${base}/suspend`, {
					method: 'POST',
					body: { operationId, confirmName: impact.workspaceName },
				})
			},
		})
	}

	function reactivationImpact(impact: SuspensionImpact): ImpactEntry[] {
		const invoice = impact.nextInvoice
		return [
			{
				icon: 'i-ph-users',
				label: t(
					`${D}.reactivate.impact_members`,
					{ count: impact.members },
					impact.members,
				),
			},
			{
				icon: 'i-ph-credit-card',
				label: invoice
					? t(`${D}.reactivate.impact_billing`, {
							date: day(invoice.date),
							amount: money(invoice.amountMinor, invoice.currency),
						})
					: t(`${D}.reactivate.impact_billing_plain`),
			},
		]
	}

	async function confirmReactivate(): Promise<boolean> {
		const impact = await $authFetch<SuspensionImpact>(
			`${base}/suspension-impact`,
		)
		const operationId = crypto.randomUUID()
		return confirm({
			title: t(`${D}.reactivate.title`, { name: impact.workspaceName }),
			description: impact.suspendedSince
				? t(`${D}.reactivate.suspended_since`, {
						date: day(impact.suspendedSince),
						by: impact.suspendedBy ?? t(`${D}.reactivate.automatically`),
					})
				: t(`${D}.reactivate.description`),
			icon: 'i-ph-play-circle',
			color: 'primary',
			confirmLabel: t(`${D}.reactivate.confirm`),
			impact: reactivationImpact(impact),
			onConfirm: async () => {
				await $authFetch(`${base}/unsuspend`, {
					method: 'POST',
					body: { operationId },
				})
			},
		})
	}

	return {
		join: () => guarded(confirmJoin, `${D}.join.success`),
		suspend: () => guarded(confirmSuspend, `${D}.suspend.success`),
		reactivate: () => guarded(confirmReactivate, `${D}.reactivate.success`),
	}
}
