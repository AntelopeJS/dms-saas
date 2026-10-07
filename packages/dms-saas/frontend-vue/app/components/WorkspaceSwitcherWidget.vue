<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { HOME_PATH } from '../build/workspace-paths'
import WorkspaceSwitcherRow from '../build/WorkspaceSwitcherRow.vue'

const props = defineProps<{
	collapsed?: boolean
}>()

const KEYS = 'saas.workspace.switcher'
const SEARCH_THRESHOLD = 6
const PAST_DUE_STATUS = 'past_due'
/** Window event a DMS form dispatches once it saved (`FormEvents.SUBMIT_SUCCESS`). */
const FORM_SUBMIT_SUCCESS_EVENT = 'DmsComponent.Form.SubmitSuccess'
/** The General page's rename form, which changes what the trigger shows. */
const RENAME_SUBMIT_URL = '/api/saas/workspaces/current'

interface FormSubmitPayload {
	submitUrl?: string
}

interface FormSubmitDetail {
	data?: FormSubmitPayload
}

const toast = useToast()
const { t } = useI18n()
const { statusView } = useSaasStatus()

// Platform owners are not tenant members by default, so an owner can legitimately
// have no workspace at all — the switcher must still offer them a way in.
const isOwner = useIsOwner()
const config = useDmsRuntimeConfig()
const canCreateWorkspace = computed(
	() =>
		isOwner.value ||
		(config.public.dmsSaas as DmsSaasPublicRuntimeConfig | undefined)
			?.admissionMode !== 'invitation-only',
)

const { workspaces, isLoaded, refresh } = useMyWorkspaces()
const hasFailed = ref(false)
const isOpen = ref(false)
const isCreateOpen = ref(false)
const searchQuery = ref('')
const switchingId = ref<string | null>(null)

const current = computed<MyWorkspace | undefined>(() =>
	workspaces.value.find((workspace) => workspace.isCurrent),
)
const isPastDue = computed(() => current.value?.status === PAST_DUE_STATUS)
const showSearch = computed(() => workspaces.value.length >= SEARCH_THRESHOLD)
const isVisible = computed(
	() => workspaces.value.length > 0 || isOwner.value || hasFailed.value,
)

const triggerLabel = computed(() => current.value?.name ?? t(`${KEYS}.none`))
const triggerCaption = computed(
	() => current.value?.planName ?? t(`${KEYS}.caption`),
)

const tooltip = computed(() => {
	const workspace = current.value
	if (!workspace) return triggerLabel.value
	const parts = [workspace.name, workspace.planName ?? t(`${KEYS}.no_plan`)]
	if (isPastDue.value) parts.push(t(`${KEYS}.payment_failed`))
	return parts.join(' · ')
})

const filtered = computed<MyWorkspace[]>(() => {
	const needle = searchQuery.value.trim().toLowerCase()
	if (!needle) return workspaces.value
	return workspaces.value.filter((workspace) =>
		[workspace.name, workspace.ownerName ?? ''].some((text) =>
			text.toLowerCase().includes(needle),
		),
	)
})

const popoverPlacement = computed(() =>
	props.collapsed
		? { side: 'right' as const, align: 'start' as const, sideOffset: 12 }
		: { side: 'bottom' as const, align: 'start' as const, sideOffset: 6 },
)

watch(isOpen, (open) => {
	if (!open && !switchingId.value) searchQuery.value = ''
})

function initialOf(name: string): string {
	return (name.trim()[0] ?? '?').toUpperCase()
}

async function load(): Promise<void> {
	try {
		await refresh()
		hasFailed.value = false
	} catch {
		hasFailed.value = true
	}
}

function reportSwitchFailure(target: MyWorkspace | string): void {
	const name = typeof target === 'string' ? target : target.name
	toast.add({
		title: t(`${KEYS}.switch_failed`, { name }),
		description: current.value
			? t(`${KEYS}.still_in`, { name: current.value.name })
			: undefined,
		color: 'error',
		icon: 'i-ph-warning-circle',
	})
}

/** The popover stays open until the page reloads into the new workspace. */
async function selectWorkspace(workspace: MyWorkspace): Promise<void> {
	if (workspace.isCurrent || switchingId.value) return
	switchingId.value = workspace._id
	try {
		await useTenantSwitch(workspace._id)
	} catch {
		switchingId.value = null
		reportSwitchFailure(workspace)
	}
}

function openCreateModal(): void {
	isOpen.value = false
	isCreateOpen.value = true
}

function closeCreateModal(): void {
	isCreateOpen.value = false
}

async function onWorkspaceCreated(
	tenantId: string,
	name: string,
): Promise<void> {
	isCreateOpen.value = false
	try {
		// Lands on the homepage rather than reloading the screen the creation
		// was started from — that screen belongs to the previous workspace.
		await useTenantSwitch(tenantId, HOME_PATH)
	} catch {
		reportSwitchFailure(name)
		await load()
	}
}

function onFormSaved(event: Event): void {
	const detail = (event as CustomEvent<FormSubmitDetail>).detail
	if (detail?.data?.submitUrl === RENAME_SUBMIT_URL) void load()
}

onMounted(() => {
	if (!isLoaded.value) void load()
	window.addEventListener(FORM_SUBMIT_SUCCESS_EVENT, onFormSaved)
})

onBeforeUnmount(() => {
	window.removeEventListener(FORM_SUBMIT_SUCCESS_EVENT, onFormSaved)
})
</script>

<template>
	<USkeleton
		v-if="!isLoaded && !hasFailed"
		:class="
			collapsed ? 'mx-auto size-9 rounded-md' : 'h-[46px] w-full rounded-md'
		"
	/>
	<UPopover
		v-else-if="isVisible"
		v-model:open="isOpen"
		:content="popoverPlacement"
	>
		<UTooltip
			:text="tooltip"
			:disabled="!collapsed"
			:content="{ side: 'right' }"
		>
			<button
				type="button"
				class="border-default bg-elevated text-highlighted hover:border-accented relative flex items-center gap-2.5 rounded-md border text-left transition-colors duration-150"
				:class="
					collapsed ? 'size-9 justify-center p-1' : 'w-full px-2.5 py-[9px]'
				"
				:aria-label="$t(`${KEYS}.title`)"
			>
				<span
					class="from-primary-500 to-primary-600 bg-linear-to-br relative inline-flex size-[26px] shrink-0 items-center justify-center rounded-md text-[13px] font-bold text-white"
				>
					<template v-if="current">{{ initialOf(current.name) }}</template>
					<UIcon v-else name="i-ph-buildings" class="size-4" />
					<span
						v-if="isPastDue"
						class="bg-error ring-default absolute -right-1 -top-1 size-2.5 rounded-full ring-2"
						:aria-label="$t(`${KEYS}.payment_failed`)"
						role="img"
					/>
				</span>
				<template v-if="!collapsed">
					<span class="flex min-w-0 flex-1 flex-col leading-[1.25]">
						<span
							class="text-primary font-mono text-[10px] uppercase tracking-[0.08em]"
						>
							{{ triggerCaption }}
						</span>
						<span
							class="text-highlighted truncate text-[13.5px] font-semibold tracking-[-0.01em]"
						>
							{{ triggerLabel }}
						</span>
					</span>
					<UIcon
						name="i-ph-caret-up-down"
						class="text-dimmed ml-auto size-4 shrink-0"
					/>
				</template>
			</button>
		</UTooltip>

		<template #content>
			<div class="flex w-72 flex-col gap-1 p-1.5">
				<p
					class="text-dimmed flex items-center gap-1.5 px-2 pb-0.5 pt-1 text-[11px]"
				>
					{{ $t(`${KEYS}.title`) }}
					<UBadge
						v-if="showSearch"
						:label="String(workspaces.length)"
						color="neutral"
						variant="soft"
						size="sm"
						class="font-mono"
					/>
				</p>
				<UInput
					v-if="showSearch"
					v-model="searchQuery"
					size="sm"
					icon="i-ph-magnifying-glass"
					:placeholder="$t(`${KEYS}.search`)"
					:aria-label="$t(`${KEYS}.search`)"
					autofocus
				/>
				<DmsSaasLoadFailure
					v-if="hasFailed && !workspaces.length"
					:title="$t(`${KEYS}.load_failed`)"
					@retry="load"
				/>
				<ul
					v-else-if="filtered.length"
					class="m-0 flex max-h-72 list-none flex-col gap-0.5 overflow-y-auto p-0"
				>
					<li v-for="workspace in filtered" :key="workspace._id">
						<WorkspaceSwitcherRow
							:workspace="workspace"
							:query="searchQuery"
							:is-switching="switchingId === workspace._id"
							:is-disabled="!!switchingId"
							@select="selectWorkspace"
						/>
					</li>
				</ul>
				<div
					v-else-if="workspaces.length"
					class="flex flex-col items-start gap-1 px-2 py-2"
				>
					<p class="text-muted text-[13px]">
						{{ $t(`${KEYS}.no_match`, { query: searchQuery.trim() }) }}
					</p>
					<UButton
						color="neutral"
						variant="link"
						size="xs"
						class="px-0"
						@click="searchQuery = ''"
					>
						{{ $t(`${KEYS}.clear_search`) }}
					</UButton>
				</div>
				<template v-if="canCreateWorkspace">
					<USeparator class="my-0.5" />
					<UButton
						color="primary"
						variant="ghost"
						size="sm"
						icon="i-ph-plus"
						class="justify-start"
						:disabled="!!switchingId"
						@click="openCreateModal"
					>
						{{ $t(`${KEYS}.create`) }}
					</UButton>
				</template>
			</div>
		</template>
	</UPopover>

	<UModal
		v-model:open="isCreateOpen"
		:title="$t('saas.workspace.create.title')"
		:description="$t('saas.workspace.create.description')"
	>
		<template #body>
			<DmsSaasWorkspaceCreateModal
				:on-success-callback="onWorkspaceCreated"
				:on-cancel-callback="closeCreateModal"
			/>
		</template>
	</UModal>
</template>
