<script setup lang="ts">
/** The caller's other workspaces, each one switch away. */
import { ref } from 'vue'
import { type OtherWorkspace, workspaceInitials } from './access'
import { HOME_PATH } from './routes'

interface OtherWorkspacesProps {
	workspaces: OtherWorkspace[]
}

defineProps<OtherWorkspacesProps>()

const { t } = useI18n()
const toast = useToast()
const { statusView } = useSaasStatus()
const { resolveApiError } = useApiErrorMessage()

const switchingTo = ref<string | null>(null)

function roleLine(workspace: OtherWorkspace): string {
	const role = workspace.isTenantOwner
		? t('saas.public.suspended.others.owner')
		: t('saas.public.suspended.others.member')
	return workspace.planName ? `${workspace.planName} · ${role}` : role
}

async function open(workspace: OtherWorkspace): Promise<void> {
	switchingTo.value = workspace._id
	try {
		await useTenantSwitch(workspace._id, HOME_PATH)
	} catch (error) {
		toast.add({
			color: 'error',
			title: t('saas.public.suspended.others.switch_failed', {
				name: workspace.name,
			}),
			description: resolveApiError(
				error,
				'saas.public.suspended.others.switch_failed_hint',
			),
		})
		switchingTo.value = null
	}
}
</script>

<template>
	<DmsCard
		:title="$t('saas.public.suspended.others.title')"
		:count="workspaces.length"
		:padded="false"
	>
		<DmsListRow
			v-for="workspace in workspaces"
			:key="workspace._id"
			size="sm"
			:title="workspace.name"
			:description="roleLine(workspace)"
		>
			<template #leading>
				<DmsIconWell tone="muted" size="sm">
					<span class="font-mono text-[11px] font-semibold">
						{{ workspaceInitials(workspace.name) }}
					</span>
				</DmsIconWell>
			</template>
			<template #trailing>
				<div class="flex items-center gap-2">
					<DmsStatusPill
						v-if="workspace.status"
						:label="statusView('workspace', workspace.status).label"
						:tone="statusView('workspace', workspace.status).tone"
						size="sm"
					/>
					<UButton
						:label="$t('saas.public.suspended.others.open')"
						size="xs"
						color="neutral"
						variant="outline"
						:loading="switchingTo === workspace._id"
						:disabled="switchingTo !== null"
						@click="open(workspace)"
					/>
				</div>
			</template>
		</DmsListRow>
	</DmsCard>
</template>
