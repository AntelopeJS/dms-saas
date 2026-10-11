<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import {
	flattenPermissionTree,
	grantPermission,
	matchesSearch,
	type PermissionNode,
	type PermissionRow,
	revokePermission,
} from './plan-permissions'

const props = defineProps<{
	planName: string
	parentName: string | null
	tree: PermissionNode[]
	own: string[]
	inherited: string[]
}>()

const open = defineModel<boolean>('open', { default: false })
const emit = defineEmits<{ apply: [permissions: string[]] }>()

const { processI18n } = useTranslation()

const draft = ref<Set<string>>(new Set(props.own))
const search = ref('')
const expanded = ref<Set<string>>(new Set())

watch(open, (isOpen) => {
	if (!isOpen) return
	draft.value = new Set(props.own)
	search.value = ''
})

const rows = computed(() => flattenPermissionTree(props.tree))
const inheritedSet = computed(() => new Set(props.inherited))
const allIds = computed(() => rows.value.map((row) => row.node.id))
const groups = computed(() => rows.value.filter((row) => row.depth === 0))

function labelOf(node: PermissionNode): string {
	return processI18n(node.label)
}

function isGranted(id: string): boolean {
	return draft.value.has(id) || inheritedSet.value.has(id)
}

const grantedCount = computed(() => allIds.value.filter(isGranted).length)
const delta = computed(() => {
	const before = new Set(props.own)
	const added = [...draft.value].filter((id) => !before.has(id)).length
	const removed = props.own.filter((id) => !draft.value.has(id)).length
	return added - removed
})

function groupRows(group: PermissionRow): PermissionRow[] {
	return rows.value.filter(
		(row) =>
			row.groupId === group.node.id &&
			row.depth > 0 &&
			matchesSearch(row, rows.value, search.value, labelOf),
	)
}

function groupCount(group: PermissionRow): string {
	const ids = [group.node.id, ...group.descendants]
	return `${ids.filter(isGranted).length} / ${ids.length}`
}

const shownGroups = computed(() =>
	groups.value.filter((group) =>
		matchesSearch(group, rows.value, search.value, labelOf),
	),
)

function isExpanded(group: PermissionRow): boolean {
	return search.value.length > 0 || expanded.value.has(group.node.id)
}

function toggleGroup(group: PermissionRow): void {
	const next = new Set(expanded.value)
	if (next.has(group.node.id)) next.delete(group.node.id)
	else next.add(group.node.id)
	expanded.value = next
}

const isAllExpanded = computed(() =>
	groups.value.every((group) => expanded.value.has(group.node.id)),
)

function toggleAll(): void {
	expanded.value = isAllExpanded.value
		? new Set()
		: new Set(groups.value.map((group) => group.node.id))
}

function toggleRow(row: PermissionRow, value: boolean | 'indeterminate'): void {
	draft.value =
		value === true
			? grantPermission(draft.value, row)
			: revokePermission(draft.value, row)
}

function apply(): void {
	emit(
		'apply',
		[...draft.value].filter((id) => !inheritedSet.value.has(id)),
	)
	open.value = false
}
</script>

<template>
	<UModal
		v-model:open="open"
		:title="$t('saas.catalog.editor.permissions.title', { name: planName })"
		:description="
			parentName
				? $t('saas.catalog.editor.permissions.description_parent', {
						granted: grantedCount,
						total: allIds.length,
						parent: parentName,
					})
				: $t('saas.catalog.editor.permissions.description', {
						granted: grantedCount,
						total: allIds.length,
					})
		"
		:ui="{ content: 'max-w-2xl' }"
	>
		<template #body>
			<div class="flex flex-col gap-3">
				<div class="flex items-center gap-2">
					<UInput
						v-model="search"
						icon="i-ph-magnifying-glass"
						class="flex-1"
						:placeholder="$t('saas.catalog.editor.permissions.search')"
					/>
					<UButton color="neutral" variant="ghost" size="sm" @click="toggleAll">
						{{
							isAllExpanded
								? $t('saas.catalog.editor.permissions.collapse_all')
								: $t('saas.catalog.editor.permissions.expand_all')
						}}
					</UButton>
				</div>
				<p
					v-if="shownGroups.length === 0"
					class="text-muted py-6 text-center text-sm"
				>
					{{ $t('saas.catalog.editor.permissions.no_match', { search }) }}
				</p>
				<div
					v-for="group in shownGroups"
					:key="group.node.id"
					class="border-default rounded-lg border"
				>
					<div class="flex items-center gap-2 px-3 py-2">
						<UButton
							color="neutral"
							variant="ghost"
							size="xs"
							square
							:icon="isExpanded(group) ? 'i-ph-caret-down' : 'i-ph-caret-right'"
							:aria-expanded="isExpanded(group)"
							:aria-label="labelOf(group.node)"
							@click="toggleGroup(group)"
						/>
						<UCheckbox
							:model-value="isGranted(group.node.id)"
							:disabled="inheritedSet.has(group.node.id)"
							:label="labelOf(group.node)"
							class="flex-1 font-medium"
							@update:model-value="
								(value: boolean | 'indeterminate') => toggleRow(group, value)
							"
						/>
						<span class="text-muted text-xs tabular-nums">
							{{ groupCount(group) }}
						</span>
					</div>
					<ul
						v-if="isExpanded(group)"
						class="border-default divide-default divide-y border-t"
					>
						<li
							v-for="row in groupRows(group)"
							:key="row.node.id"
							class="flex items-center gap-2 py-1.5 pr-3"
							:style="{ paddingLeft: `${row.depth * 1.25 + 2.5}rem` }"
						>
							<UCheckbox
								:model-value="isGranted(row.node.id)"
								:disabled="inheritedSet.has(row.node.id)"
								:label="labelOf(row.node)"
								:description="
									row.node.description
										? processI18n(row.node.description)
										: undefined
								"
								class="flex-1"
								@update:model-value="
									(value: boolean | 'indeterminate') => toggleRow(row, value)
								"
							/>
							<UBadge
								v-if="inheritedSet.has(row.node.id) && parentName"
								size="sm"
								color="neutral"
								variant="soft"
							>
								{{ parentName }}
							</UBadge>
							<UBadge
								v-else-if="draft.has(row.node.id)"
								size="sm"
								color="primary"
								variant="soft"
							>
								{{ planName }}
							</UBadge>
						</li>
					</ul>
				</div>
			</div>
		</template>
		<template #footer>
			<div class="flex w-full items-center justify-end gap-2">
				<span v-if="delta !== 0" class="text-muted mr-auto text-xs">
					{{
						$t('saas.catalog.editor.permissions.delta', {
							count: delta > 0 ? `+${delta}` : `${delta}`,
						})
					}}
				</span>
				<UButton color="neutral" variant="outline" @click="open = false">
					{{ $t('saas.catalog.common.cancel') }}
				</UButton>
				<UButton @click="apply">
					{{ $t('saas.catalog.editor.permissions.apply') }}
				</UButton>
			</div>
		</template>
	</UModal>
</template>
