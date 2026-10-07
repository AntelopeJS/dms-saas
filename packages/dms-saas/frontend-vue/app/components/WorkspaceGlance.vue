<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { BILLING_PATH, MEMBERS_PATH } from '../build/workspace-paths'

/** A cell of `DmsStatGroup`, whose item type the DMS keeps in the component. */
interface GlanceItem {
	id: string
	icon: string
	eyebrow: string
	value: string
	detail?: string
	detailTone?: SaasTone
	to: string
}

const KEYS = 'saas.workspace.general.glance'
const GLANCE_ITEMS = 3
const HEALTHY_TONE = 'success'
const DATE_FORMAT: Intl.DateTimeFormatOptions = {
	day: 'numeric',
	month: 'short',
	year: 'numeric',
}

const { t, locale } = useI18n()
const { statusView } = useSaasStatus()
const planPriceLabel = usePlanPriceLabel()
const { data: overview, error, refresh } = useWorkspaceOverview()

function formatDay(value: string | null | undefined): string {
	return formatDate(value, locale.value, DATE_FORMAT) ?? '—'
}

function membersItem(view: WorkspaceOverview): GlanceItem {
	const { seats } = view
	return {
		id: 'members',
		icon: 'i-ph-users-three',
		eyebrow: t(`${KEYS}.members`),
		value:
			seats.maxMembers === null
				? t(`${KEYS}.seats_unlimited`, { occupied: seats.occupied })
				: t(`${KEYS}.seats_of`, {
						occupied: seats.occupied,
						max: seats.maxMembers,
					}),
		detail: t(`${KEYS}.seats_detail`, {
			members: t(`${KEYS}.members_count`, seats.members),
			invites: t(`${KEYS}.invites_count`, seats.pendingInvites),
		}),
		to: MEMBERS_PATH,
	}
}

function planDetail(plan: WorkspacePlanOverview): string {
	const parts = [
		statusView('workspace', plan.status).label,
		plan.isComplimentary ? t(`${KEYS}.complimentary`) : planPriceLabel(plan),
	]
	if (plan.renewsAt) {
		parts.push(t(`${KEYS}.renews`, { date: formatDay(plan.renewsAt) }))
	}
	return parts.join(' · ')
}

function planItem(view: WorkspaceOverview): GlanceItem {
	const { plan } = view
	const tone = plan ? statusView('workspace', plan.status).tone : 'neutral'
	return {
		id: 'plan',
		icon: 'i-ph-stack',
		eyebrow: t(`${KEYS}.plan`),
		value: plan?.name ?? t(`${KEYS}.no_plan`),
		detail: plan ? planDetail(plan) : undefined,
		detailTone: tone === HEALTHY_TONE ? undefined : tone,
		to: BILLING_PATH,
	}
}

function ownerItem(view: WorkspaceOverview): GlanceItem {
	const [first, ...others] = view.owners
	const created = t(`${KEYS}.created`, {
		name: view.name,
		date: formatDay(view.createdAt),
	})
	const lead = first?.isCaller ? `${t(`${KEYS}.you`)} · ${created}` : created
	return {
		id: 'owner',
		icon: 'i-ph-crown-simple',
		eyebrow: t(`${KEYS}.owner`),
		value: first
			? [
					first.name,
					...(others.length ? [t(`${KEYS}.more_owners`, others.length)] : []),
				].join(' ')
			: '—',
		detail: lead,
		to: MEMBERS_PATH,
	}
}

const items = computed<GlanceItem[]>(() => {
	const view = overview.value
	return view ? [membersItem(view), planItem(view), ownerItem(view)] : []
})

onMounted(refresh)
</script>

<template>
	<DmsSaasLoadFailure
		v-if="error && !overview"
		:title="$t(`${KEYS}.load_failed`)"
		@retry="refresh"
	/>
	<DmsStatGroup
		v-else
		layout="cards"
		:columns="GLANCE_ITEMS"
		:skeleton-count="GLANCE_ITEMS"
		:loading="!overview"
		:items="items"
		:label="$t(`${KEYS}.title`)"
	/>
</template>
