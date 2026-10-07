<script setup lang="ts">
import { computed } from 'vue'
import { highlightParts } from './highlight'

const props = defineProps<{
	workspace: MyWorkspace
	query: string
	isSwitching: boolean
	isDisabled: boolean
}>()

const emit = defineEmits<{ select: [workspace: MyWorkspace] }>()

const KEYS = 'saas.workspace.switcher'
/** States that need no word in the list: the workspace simply works. */
const QUIET_STATUSES = new Set(['active', 'trialing', 'free'])
const MATCH_CLASS = 'bg-primary/20 text-highlighted rounded-[2px]'

const { t } = useI18n()
const { statusView } = useSaasStatus()

const nameParts = computed(() =>
	highlightParts(props.workspace.name, props.query),
)

/**
 * The owner is named only when the search matched on them, or when the
 * caller does not own the workspace: otherwise the member count says more.
 */
const showsOwner = computed(() => {
	const { ownerName, isOwner } = props.workspace
	if (!ownerName) return false
	const needle = props.query.trim().toLowerCase()
	return !isOwner || (!!needle && ownerName.toLowerCase().includes(needle))
})

const ownerParts = computed(() =>
	highlightParts(props.workspace.ownerName ?? '', props.query),
)

const leadMeta = computed(() => {
	const { planName, isComplimentary, membersCount } = props.workspace
	const plan = planName ?? t(`${KEYS}.no_plan`)
	if (isComplimentary) return `${plan} · ${t(`${KEYS}.complimentary`)}`
	if (showsOwner.value) return `${plan} · ${t(`${KEYS}.owner_prefix`)}`
	return `${plan} · ${t(`${KEYS}.members_count`, membersCount)}`
})

const status = computed(() =>
	QUIET_STATUSES.has(props.workspace.status)
		? null
		: statusView('workspace', props.workspace.status),
)

function initialOf(name: string): string {
	return (name.trim()[0] ?? '?').toUpperCase()
}
</script>

<template>
	<button
		type="button"
		class="hover:bg-elevated flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-[13px] transition-colors"
		:class="[
			workspace.isCurrent ? 'bg-primary/10' : 'bg-transparent',
			{ 'cursor-default': workspace.isCurrent || isDisabled },
		]"
		:aria-current="workspace.isCurrent ? 'true' : undefined"
		:aria-busy="isSwitching || undefined"
		:disabled="isDisabled && !isSwitching"
		@click="emit('select', workspace)"
	>
		<span
			class="from-primary-500 to-primary-600 bg-linear-to-br inline-flex size-[22px] shrink-0 items-center justify-center rounded-[5px] text-[11px] font-bold text-white"
			aria-hidden="true"
		>
			{{ initialOf(workspace.name) }}
		</span>
		<span class="flex min-w-0 flex-1 flex-col">
			<span class="text-highlighted truncate font-medium">
				<!-- v-text keeps prettier's line breaks out of the highlighted runs -->
				<template v-for="(part, index) in nameParts" :key="index">
					<mark v-if="part.isMatch" :class="MATCH_CLASS" v-text="part.text" />
					<span v-else v-text="part.text" />
				</template>
			</span>
			<span class="text-muted truncate text-[11.5px]">
				{{ leadMeta }}
				<template v-if="showsOwner">
					<template v-for="(part, index) in ownerParts" :key="index">
						<mark v-if="part.isMatch" :class="MATCH_CLASS" v-text="part.text" />
						<span v-else v-text="part.text" />
					</template>
				</template>
			</span>
		</span>
		<DmsStatusPill
			v-if="status"
			size="sm"
			:tone="status.tone"
			:label="status.label"
		/>
		<UIcon
			v-if="isSwitching"
			name="i-ph-spinner-gap"
			class="text-primary size-4 shrink-0 animate-spin"
			:aria-label="$t(`${KEYS}.switching`)"
		/>
		<UIcon
			v-else-if="workspace.isCurrent"
			name="i-ph-check"
			class="text-primary size-4 shrink-0"
			:aria-label="$t(`${KEYS}.current`)"
		/>
	</button>
</template>
