<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'

const props = defineProps<{
	collapsed?: boolean
}>()

interface DmsSaasPublicRuntimeConfig {
	admissionMode?: 'open' | 'invitation-only'
}

const toast = useToast()
const { t } = useI18n()
const { resolveApiError } = useApiErrorMessage()

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

const SEARCH_THRESHOLD = 6
const HOME_ROUTE = '/'

const { workspaces, refresh } = useMyWorkspaces()
const isLoading = ref(true)
const isOpen = ref(false)
const isCreateOpen = ref(false)
const searchQuery = ref('')
const switchingId = ref<string | null>(null)

const current = computed<MyWorkspace | undefined>(
	() => workspaces.value.find((w) => w.isCurrent) ?? workspaces.value[0],
)

const showSearch = computed(() => workspaces.value.length >= SEARCH_THRESHOLD)

const isVisible = computed(() => !!current.value || isOwner.value)

const triggerLabel = computed(
	() => current.value?.name ?? t('saas.workspaces.none'),
)

const triggerCaption = computed(
	() => current.value?.planName ?? t('saas.workspaces.current_label'),
)

const filtered = computed<MyWorkspace[]>(() => {
	const needle = searchQuery.value.trim().toLowerCase()
	if (!needle) return workspaces.value
	return workspaces.value.filter((w) => w.name.toLowerCase().includes(needle))
})

watch(isOpen, (open) => {
	if (!open) searchQuery.value = ''
})

const popoverPlacement = computed(() =>
	props.collapsed
		? { side: 'right' as const, align: 'start' as const, sideOffset: 12 }
		: { side: 'bottom' as const, align: 'start' as const, sideOffset: 6 },
)

function initialOf(name: string): string {
	return (name.trim()[0] ?? '?').toUpperCase()
}

async function load(): Promise<void> {
	try {
		await refresh()
	} catch {
		// Errors are swallowed on purpose: useMyWorkspaces already decides what the
		// list becomes, and the sidebar is no place for an error card.
	} finally {
		isLoading.value = false
	}
}

async function selectWorkspace(workspace: MyWorkspace): Promise<void> {
	if (workspace.isCurrent || switchingId.value) return
	switchingId.value = workspace._id
	try {
		// Reloads the page on success, so the switching state never resets.
		await useTenantSwitch(workspace._id)
	} catch (error) {
		switchingId.value = null
		toast.add({
			title: resolveApiError(error, 'saas.workspaces.switch_error'),
			color: 'error',
			icon: 'i-ph-warning-circle',
		})
	}
}

function openCreateModal(): void {
	isOpen.value = false
	isCreateOpen.value = true
}

function closeCreateModal(): void {
	isCreateOpen.value = false
}

async function onWorkspaceCreated(tenantId: string): Promise<void> {
	isCreateOpen.value = false
	try {
		// Lands on the DMS homepage rather than reloading the settings screen the
		// creation was started from — that screen belongs to the previous tenant.
		await useTenantSwitch(tenantId, HOME_ROUTE)
	} catch (error) {
		toast.add({
			title: resolveApiError(error, 'saas.workspaces.switch_error'),
			color: 'error',
			icon: 'i-ph-warning-circle',
		})
		load()
	}
}

onMounted(load)
</script>

<template>
	<USkeleton
		v-if="isLoading"
		:class="
			collapsed ? 'mx-auto size-9 rounded-md' : 'h-[46px] w-full rounded-md'
		"
	/>
	<UPopover
		v-else-if="isVisible"
		v-model:open="isOpen"
		:content="popoverPlacement"
		:ui="{
			content: 'rounded-none border-0 bg-transparent p-0 shadow-none ring-0',
		}"
	>
		<UTooltip
			:text="triggerLabel"
			:disabled="!collapsed"
			:content="{ side: 'right' }"
		>
			<button
				type="button"
				class="border-default bg-elevated text-highlighted hover:border-accented flex items-center gap-2.5 rounded-md border text-left transition-colors duration-150"
				:class="
					collapsed ? 'size-9 justify-center p-1' : 'w-full px-2.5 py-[9px]'
				"
				:aria-label="$t('saas.workspaces.switcher_title')"
			>
				<span
					class="from-primary-500 to-primary-600 bg-linear-to-br inline-flex size-[26px] shrink-0 items-center justify-center rounded-md text-[13px] font-bold text-white"
				>
					<template v-if="current">{{ initialOf(current.name) }}</template>
					<svg
						v-if="!current"
						class="size-4"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="1.8"
						stroke-linecap="round"
						stroke-linejoin="round"
						aria-hidden="true"
					>
						<path
							d="M3 21h18M5 21V5l7-3 7 3v16M9 9h.01M15 9h.01M9 13h.01M15 13h.01M9 17h.01M15 17h.01"
						/>
					</svg>
				</span>
				<template v-if="!collapsed">
					<span class="flex min-w-0 flex-1 flex-col leading-[1.25]">
						<span
							class="text-primary font-mono text-[10px] uppercase tracking-[0.08em]"
						>
							{{ triggerCaption }}
						</span>
						<span
							class="text-highlighted overflow-hidden text-ellipsis whitespace-nowrap text-[13.5px] font-semibold tracking-[-0.01em]"
						>
							{{ triggerLabel }}
						</span>
					</span>
					<span
						class="text-dimmed ml-auto inline-flex size-4 shrink-0"
						aria-hidden="true"
					>
						<svg
							class="h-full w-full"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="1.8"
							stroke-linecap="round"
							stroke-linejoin="round"
						>
							<path d="m7 15 5 5 5-5" />
							<path d="m7 9 5-5 5 5" />
						</svg>
					</span>
				</template>
			</button>
		</UTooltip>

		<template #content>
			<div
				class="border-accented bg-elevated flex w-56 flex-col gap-0.5 rounded-lg border p-[5px] shadow-lg"
			>
				<p class="text-dimmed m-0 px-[9px] pb-[3px] pt-[5px] text-[10.5px]">
					{{ $t('saas.workspaces.switcher_title') }}
				</p>
				<input
					v-if="showSearch"
					v-model="searchQuery"
					class="border-accented bg-default text-highlighted w-full rounded-md border px-2 py-1.5 text-xs"
					type="search"
					:placeholder="$t('saas.workspaces.select')"
				/>
				<ul
					v-if="filtered.length"
					class="m-0 max-h-64 list-none overflow-y-auto p-0"
				>
					<li v-for="workspace in filtered" :key="workspace._id">
						<button
							type="button"
							class="hover:bg-accented hover:text-highlighted flex w-full items-center gap-[9px] rounded-md border-0 px-[9px] py-2 text-left text-[13px]"
							:class="[
								workspace.isCurrent
									? 'bg-primary/12 text-highlighted'
									: 'text-muted bg-transparent',
								{ 'cursor-default': workspace.isCurrent || !!switchingId },
							]"
							@click="selectWorkspace(workspace)"
						>
							<span
								class="from-primary-500 to-primary-600 bg-linear-to-br inline-flex size-[22px] shrink-0 items-center justify-center rounded-[5px] text-[11px] font-bold text-white"
							>
								{{ initialOf(workspace.name) }}
							</span>
							<span
								class="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap"
								:class="{ 'text-highlighted': workspace.isCurrent }"
							>
								{{ workspace.name }}
							</span>
							<span
								v-if="workspace.planName"
								class="text-primary shrink-0 whitespace-nowrap font-mono text-[9.5px] uppercase tracking-[0.08em]"
							>
								{{ workspace.planName }}
							</span>
							<span
								v-if="switchingId === workspace._id"
								class="border-(--ui-text-dimmed) border-t-primary size-3.5 shrink-0 animate-spin rounded-full border-2 [animation-duration:700ms]"
								aria-hidden="true"
							/>
							<span
								v-else-if="workspace.isCurrent"
								class="text-primary inline-flex size-4 shrink-0"
								aria-hidden="true"
							>
								<svg
									class="h-full w-full"
									viewBox="0 0 24 24"
									fill="none"
									stroke="currentColor"
									stroke-width="1.8"
									stroke-linecap="round"
									stroke-linejoin="round"
								>
									<path d="m4 12 5 5L20 6" />
								</svg>
							</span>
						</button>
					</li>
				</ul>
				<p
					v-else-if="workspaces.length"
					class="text-dimmed m-0 px-[9px] py-2 text-[13px]"
				>
					{{ $t('saas.workspaces.no_results') }}
				</p>
				<div v-if="workspaces.length" class="bg-border mx-0.5 my-1 h-px" />
				<button
					v-if="canCreateWorkspace"
					type="button"
					class="text-primary w-full justify-start border-0 bg-transparent px-[9px] py-2 text-left text-[13px]"
					@click="openCreateModal"
				>
					＋ {{ $t('saas.workspaces.create.button') }}
				</button>
			</div>
		</template>
	</UPopover>

	<UModal
		v-model:open="isCreateOpen"
		:title="$t('saas.workspaces.create.title')"
		:description="$t('saas.workspaces.create.self_serve.description')"
	>
		<template #body>
			<DmsSaasWorkspaceCreateModal
				:on-success-callback="onWorkspaceCreated"
				:on-cancel-callback="closeCreateModal"
			/>
		</template>
	</UModal>
</template>
