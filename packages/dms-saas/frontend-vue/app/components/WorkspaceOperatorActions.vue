<script setup lang="ts">
import { computed, ref } from 'vue'
import WorkspaceActionDialogs from '../build/workspace-detail/WorkspaceActionDialogs.vue'
import { useWorkspaceActions } from '../build/workspace-detail/useWorkspaceActions'
import { useWorkspaceOverview } from '../build/workspace-detail/useWorkspaceOverview'
import type { WorkspaceDialog } from '../build/workspace-detail/types'

/**
 * What a platform admin can do to the workspace beyond its plan: an
 * immediate upgrade, a Stripe credit, joining as platform support. Each row
 * says why it is unavailable when it is.
 */
const props = defineProps<{ routeParams?: Record<string, string> }>()

const D = 'saas.workspace_detail.operator'

interface OperatorRow {
	id: string
	icon: string
	title: string
	description: string
	isDisabled: boolean
	run: () => void
}

const tenantId = props.routeParams?.id ?? ''
const { t } = useI18n()
const { overview, isLoading, hasError, load } = useWorkspaceOverview(tenantId)
const actions = useWorkspaceActions(tenantId)
const dialogs = ref<InstanceType<typeof WorkspaceActionDialogs> | null>(null)

function openDialog(dialog: WorkspaceDialog): void {
	dialogs.value?.open(dialog)
}

const rows = computed<OperatorRow[]>(() => {
	const current = overview.value
	const isBilled = !!current?.hasStripeSubscription
	const hasCustomer = !!current?.stripeCustomerId
	return [
		{
			id: 'upgrade',
			icon: 'i-ph-arrow-circle-up',
			title: t(`${D}.upgrade`),
			description: isBilled
				? t(`${D}.upgrade_description`)
				: t(`${D}.upgrade_unavailable`),
			isDisabled: !isBilled,
			run: () => openDialog('upgrade'),
		},
		{
			id: 'credit',
			icon: 'i-ph-coins',
			title: t(`${D}.credit`),
			description: hasCustomer
				? t(`${D}.credit_description`)
				: t(`${D}.credit_unavailable`),
			isDisabled: !hasCustomer,
			run: () => openDialog('credit'),
		},
		{
			id: 'join',
			icon: 'i-ph-user-plus',
			title: current?.joinedAt ? t(`${D}.joined`) : t(`${D}.join`),
			description: t(`${D}.join_description`),
			isDisabled: !!current?.joinedAt,
			run: () => void actions.join(),
		},
	]
})
</script>

<template>
	<DmsCard :title="$t(`${D}.title`)" :padded="false">
		<div v-if="isLoading && !overview" class="flex flex-col gap-3 p-[18px]">
			<USkeleton v-for="index in 3" :key="index" class="h-10 w-full" />
		</div>
		<DmsEmptyState
			v-else-if="hasError && !overview"
			variant="error"
			size="sm"
			:title="$t(`${D}.load_error`)"
			:actions="[{ label: $t('saas.workspace_detail.retry'), onClick: load }]"
		/>
		<template v-else>
			<DmsListRow
				v-for="row in rows"
				:key="row.id"
				as="button"
				type="button"
				class="w-full text-left disabled:cursor-not-allowed disabled:opacity-60"
				:icon="row.icon"
				:title="row.title"
				:description="row.description"
				:interactive="!row.isDisabled"
				:disabled="row.isDisabled"
				@click="row.run"
			>
				<template #trailing>
					<UIcon
						v-if="!row.isDisabled"
						name="i-ph-caret-right"
						class="text-dimmed size-4"
					/>
				</template>
			</DmsListRow>
		</template>
		<WorkspaceActionDialogs
			v-if="overview"
			ref="dialogs"
			:tenant-id="tenantId"
			:workspace-name="overview.name"
		/>
	</DmsCard>
</template>
