<script setup lang="ts">
import { computed, ref, type Component } from 'vue'
import { useDetailRefresh } from '../../composables/useDetailRefresh'
import ComplimentaryDialog from './ComplimentaryDialog.vue'
import CreditDialog from './CreditDialog.vue'
import UpgradeDialog from './UpgradeDialog.vue'
import type { WorkspaceDialog } from './types'

/**
 * The money and access dialogs of a workspace, opened by the header and the
 * operator actions card alike. A dialog that succeeded refreshes the page.
 */
const props = defineProps<{
	tenantId: string
	workspaceName: string
}>()

interface DialogSpec {
	component: Component
	title: string
	description: string
}

const D = 'saas.workspace_detail'

const DIALOGS: Record<WorkspaceDialog, DialogSpec> = {
	upgrade: {
		component: UpgradeDialog,
		title: `${D}.upgrade.title`,
		description: `${D}.upgrade.description`,
	},
	credit: {
		component: CreditDialog,
		title: `${D}.credit.title`,
		description: `${D}.credit.description`,
	},
	complimentary: {
		component: ComplimentaryDialog,
		title: `${D}.complimentary.title`,
		description: `${D}.complimentary.description`,
	},
}

const { trigger } = useDetailRefresh(props.tenantId)
const opened = ref<WorkspaceDialog | null>(null)
const spec = computed(() => (opened.value ? DIALOGS[opened.value] : null))
const isOpen = computed({
	get: () => opened.value !== null,
	set: (value: boolean) => {
		if (!value) opened.value = null
	},
})

function open(dialog: WorkspaceDialog): void {
	opened.value = dialog
}

function finish(): void {
	opened.value = null
	trigger()
}

defineExpose({ open })
</script>

<template>
	<UModal
		v-model:open="isOpen"
		:title="spec ? $t(spec.title) : ''"
		:description="spec ? $t(spec.description) : ''"
		:ui="{ content: 'sm:max-w-xl' }"
	>
		<template #body>
			<component
				:is="spec.component"
				v-if="spec"
				:tenant-id="props.tenantId"
				:workspace-name="props.workspaceName"
				@done="finish"
				@cancel="opened = null"
			/>
		</template>
	</UModal>
</template>
