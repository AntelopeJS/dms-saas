<script setup lang="ts">
import { computed } from 'vue'
import { useWorkspaceActions } from '../build/workspace-detail/useWorkspaceActions'
import { useWorkspaceOverview } from '../build/workspace-detail/useWorkspaceOverview'

/**
 * The danger zone's control: "Suspend…" (impact listed, the workspace name
 * typed) or, once suspended, the lighter "Reactivate…".
 */
const props = defineProps<{ routeParams?: Record<string, string> }>()

const D = 'saas.workspace_detail.danger'

const tenantId = props.routeParams?.id ?? ''
const { overview, isLoading } = useWorkspaceOverview(tenantId)
const actions = useWorkspaceActions(tenantId)

const isSuspended = computed(() => overview.value?.status === 'suspended')
const isCancelled = computed(() => overview.value?.status === 'cancelled')
</script>

<template>
	<USkeleton v-if="isLoading && !overview" class="h-8 w-28" />
	<UButton
		v-else-if="isSuspended"
		color="primary"
		variant="outline"
		icon="i-ph-play-circle"
		@click="actions.reactivate"
	>
		{{ $t(`${D}.reactivate`) }}
	</UButton>
	<UButton
		v-else
		color="error"
		variant="outline"
		icon="i-ph-prohibit"
		:disabled="isCancelled || !overview"
		@click="actions.suspend"
	>
		{{ $t(`${D}.suspend`) }}
	</UButton>
</template>
