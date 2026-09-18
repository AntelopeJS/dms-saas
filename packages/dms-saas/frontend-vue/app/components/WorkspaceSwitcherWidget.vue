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
		:ui="{ content: 'workspace-switcher-popover' }"
	>
		<UTooltip
			:text="triggerLabel"
			:disabled="!collapsed"
			:content="{ side: 'right' }"
		>
			<button
				type="button"
				class="workspace-switcher-trigger"
				:class="{ 'workspace-switcher-trigger--collapsed': collapsed }"
				:aria-label="$t('saas.workspaces.switcher_title')"
			>
				<span class="workspace-switcher-avatar">
					<template v-if="current">{{ initialOf(current.name) }}</template>
					<svg v-if="!current" viewBox="0 0 24 24" aria-hidden="true">
						<path
							d="M3 21h18M5 21V5l7-3 7 3v16M9 9h.01M15 9h.01M9 13h.01M15 13h.01M9 17h.01M15 17h.01"
						/>
					</svg>
				</span>
				<template v-if="!collapsed">
					<span class="min-w-0 flex-1">
						<span class="workspace-switcher-plan">
							{{ triggerCaption }}
						</span>
						<span class="workspace-switcher-name">
							{{ triggerLabel }}
						</span>
					</span>
					<span class="workspace-switcher-chevron" aria-hidden="true">
						<svg viewBox="0 0 24 24">
							<path d="m7 15 5 5 5-5" />
							<path d="m7 9 5-5 5 5" />
						</svg>
					</span>
				</template>
			</button>
		</UTooltip>

		<template #content>
			<div class="workspace-switcher-menu">
				<p class="workspace-switcher-menu-title">
					{{ $t('saas.workspaces.switcher_title') }}
				</p>
				<input
					v-if="showSearch"
					v-model="searchQuery"
					class="workspace-switcher-search"
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
							class="workspace-switcher-row"
							:class="{
								'workspace-switcher-row--current': workspace.isCurrent,
								'cursor-default': workspace.isCurrent || !!switchingId,
							}"
							@click="selectWorkspace(workspace)"
						>
							<span class="workspace-switcher-row-avatar">
								{{ initialOf(workspace.name) }}
							</span>
							<span
								class="workspace-switcher-row-name"
								:class="{
									'workspace-switcher-row-name--current': workspace.isCurrent,
								}"
							>
								{{ workspace.name }}
							</span>
							<span
								v-if="workspace.planName"
								class="workspace-switcher-row-plan"
							>
								{{ workspace.planName }}
							</span>
							<span
								v-if="switchingId === workspace._id"
								class="workspace-switcher-spinner"
								aria-hidden="true"
							/>
							<span
								v-else-if="workspace.isCurrent"
								class="workspace-switcher-check"
								aria-hidden="true"
							>
								<svg viewBox="0 0 24 24"><path d="m4 12 5 5L20 6" /></svg>
							</span>
						</button>
					</li>
				</ul>
				<p v-else-if="workspaces.length" class="workspace-switcher-empty">
					{{ $t('saas.workspaces.no_results') }}
				</p>
				<div v-if="workspaces.length" class="workspace-switcher-separator" />
				<button
					v-if="canCreateWorkspace"
					type="button"
					class="workspace-switcher-create"
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
			<DmsSaasWorkspaceCreateModal :on-success-callback="onWorkspaceCreated" />
		</template>
	</UModal>
</template>

<style scoped>
:global(.workspace-switcher-popover) {
	padding: 0;
	border: 0;
	border-radius: 0;
	background: transparent;
	box-shadow: none;
}

.workspace-switcher-trigger {
	display: flex;
	align-items: center;
	gap: 10px;
	width: 100%;
	padding: 9px 10px;
	border: 1px solid rgba(120, 140, 200, 0.1);
	border-radius: 6px;
	background: #15151b;
	color: #f1f1f3;
	text-align: left;
	transition: border-color 150ms ease;
}

.workspace-switcher-trigger:hover {
	border-color: rgba(140, 160, 220, 0.18);
}

.workspace-switcher-trigger--collapsed {
	width: 36px;
	height: 36px;
	justify-content: center;
	padding: 4px;
}

.workspace-switcher-avatar,
.workspace-switcher-row-avatar {
	display: inline-flex;
	flex-shrink: 0;
	align-items: center;
	justify-content: center;
	color: #fff;
	font-weight: 700;
	background: linear-gradient(135deg, #8b5cf6, #7c3aed);
}

.workspace-switcher-avatar {
	width: 26px;
	height: 26px;
	border-radius: 6px;
	font-size: 13px;
}

.workspace-switcher-avatar svg,
.workspace-switcher-chevron svg,
.workspace-switcher-check svg {
	width: 100%;
	height: 100%;
	fill: none;
	stroke: currentColor;
	stroke-linecap: round;
	stroke-linejoin: round;
	stroke-width: 1.8;
}

.workspace-switcher-avatar svg {
	width: 16px;
	height: 16px;
}

.workspace-switcher-trigger:not(.workspace-switcher-trigger--collapsed)
	> span:nth-child(2) {
	display: flex;
	min-width: 0;
	flex-direction: column;
	line-height: 1.25;
}

.workspace-switcher-plan,
.workspace-switcher-row-plan {
	color: #a78bfa;
	font-family: 'JetBrains Mono', ui-monospace, monospace;
	letter-spacing: 0.08em;
	text-transform: uppercase;
}

.workspace-switcher-plan {
	font-size: 10px;
}

.workspace-switcher-name {
	overflow: hidden;
	color: #f1f1f3;
	font-family: 'Space Grotesk', Inter, ui-sans-serif, sans-serif;
	font-size: 13.5px;
	font-weight: 600;
	letter-spacing: -0.01em;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.workspace-switcher-chevron {
	display: inline-flex;
	width: 16px;
	height: 16px;
	margin-left: auto;
	flex-shrink: 0;
	color: #71717a;
}

.workspace-switcher-menu {
	display: flex;
	width: 224px;
	flex-direction: column;
	gap: 2px;
	padding: 5px;
	border: 1px solid rgba(140, 160, 220, 0.18);
	border-radius: 8px;
	background: #15151b;
	box-shadow: 0 16px 48px -16px rgb(0 0 0 / 70%);
}

.workspace-switcher-menu-title,
.workspace-switcher-empty {
	color: #71717a;
}

.workspace-switcher-menu-title {
	margin: 0;
	padding: 5px 9px 3px;
	font-size: 10.5px;
}

.workspace-switcher-search {
	width: 100%;
	padding: 6px 8px;
	border: 1px solid rgba(140, 160, 220, 0.18);
	border-radius: 6px;
	background: #0a0b12;
	color: #f1f1f3;
	font-size: 12px;
}

.workspace-switcher-row {
	display: flex;
	width: 100%;
	align-items: center;
	gap: 9px;
	padding: 8px 9px;
	border: 0;
	border-radius: 6px;
	background: transparent;
	color: #9b9ba4;
	font-size: 13px;
	text-align: left;
}

.workspace-switcher-row:hover {
	background: #1f1f24;
	color: #f1f1f3;
}

.workspace-switcher-row--current {
	background: color-mix(in oklab, #8b5cf6 12%, transparent);
	color: #f1f1f3;
}

.workspace-switcher-row-avatar {
	width: 22px;
	height: 22px;
	border-radius: 5px;
	font-size: 11px;
}

.workspace-switcher-row-name {
	min-width: 0;
	flex: 1;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.workspace-switcher-row-name--current {
	color: #f1f1f3;
}

.workspace-switcher-row-plan {
	flex-shrink: 0;
	font-size: 9.5px;
	white-space: nowrap;
}

.workspace-switcher-check {
	display: inline-flex;
	width: 16px;
	height: 16px;
	flex-shrink: 0;
	color: #a78bfa;
}

.workspace-switcher-spinner {
	width: 14px;
	height: 14px;
	flex-shrink: 0;
	border: 2px solid #71717a;
	border-top-color: #a78bfa;
	border-radius: 50%;
	animation: workspace-switcher-spin 700ms linear infinite;
}

.workspace-switcher-separator {
	height: 1px;
	margin: 4px 2px;
	background: rgba(120, 140, 200, 0.06);
}

.workspace-switcher-create {
	justify-content: flex-start;
	width: 100%;
	padding: 8px 9px;
	border: 0;
	background: transparent;
	color: #a78bfa;
	font-size: 13px;
	text-align: left;
}

.workspace-switcher-empty {
	margin: 0;
	padding: 8px 9px;
	font-size: 13px;
}

@keyframes workspace-switcher-spin {
	to {
		transform: rotate(360deg);
	}
}
</style>
