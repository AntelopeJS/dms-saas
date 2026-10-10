<script setup lang="ts">
import { computed } from 'vue'
import {
	childPath,
	emptySegmentGroup,
	isSegmentGroup,
	isSegmentWorkspaceRef,
	newSegmentCondition,
} from '../build/segments/tree'
import type {
	SegmentCondition,
	SegmentConditionGroup,
	SegmentLogical,
	SegmentMemberRole,
	SegmentNode,
	SegmentQuantifier,
	SegmentScope,
	SegmentWorkspaceRef,
} from '../build/segments/types'
import type { SegmentCatalog } from '../build/segments/useSegmentCatalog'

/** Deepest group the builder nests (the root is 0). */
const MAX_DEPTH = 5

const props = defineProps<{
	group: SegmentConditionGroup
	scope: SegmentScope
	catalog: SegmentCatalog
	/** Path of the group in the rules ("" for the root). */
	path: string
	depth: number
	/** Counts of the preview, by node path. */
	counts: Record<string, number>
	disabled?: boolean
}>()

const emit = defineEmits<{ update: [group: SegmentConditionGroup] }>()

const { t } = useI18n()

const fields = computed(() => props.catalog.fieldsOf(props.scope))
const plans = computed(() => props.catalog.catalog.value.plans)
const canNest = computed(() => props.depth < MAX_DEPTH)
const countLabel = computed(() =>
	props.scope === 'user'
		? 'saas.segments.builder.count_users'
		: 'saas.segments.builder.count_owners',
)

const roleItems = computed(() =>
	(['owner', 'member'] as const).map((role) => ({
		value: role,
		label: t(`saas.segments.rules.role.${role}`),
	})),
)
const quantifierItems = computed(() =>
	(['any', 'all'] as const).map((quantifier) => ({
		value: quantifier,
		label: t(`saas.segments.rules.quantifier.${quantifier}`),
	})),
)

function joinLabel(index: number): string {
	if (index === 0) return t('saas.segments.conditions.where')
	return t(`saas.segments.conditions.${props.group.logical}`)
}

function update(conditions: SegmentNode[]): void {
	emit('update', { ...props.group, conditions })
}

function replaceAt(index: number, node: SegmentNode): void {
	update(
		props.group.conditions.map((current, i) => (i === index ? node : current)),
	)
}

function removeAt(index: number): void {
	update(props.group.conditions.filter((_, i) => i !== index))
}

function duplicateAt(index: number): void {
	const copy = structuredClone(props.group.conditions[index]!)
	update([
		...props.group.conditions.slice(0, index + 1),
		copy,
		...props.group.conditions.slice(index + 1),
	])
}

function setLogical(logical: SegmentLogical): void {
	emit('update', { ...props.group, logical })
}

function addCondition(): void {
	update([...props.group.conditions, newSegmentCondition(fields.value[0])])
}

function addGroup(): void {
	update([
		...props.group.conditions,
		{ logical: 'or', conditions: [newSegmentCondition(fields.value[0])] },
	])
}

function addWorkspaceRef(): void {
	const ref: SegmentWorkspaceRef = {
		kind: 'workspaceRef',
		quantifier: 'any',
		role: 'owner',
		conditions: emptySegmentGroup(),
	}
	update([...props.group.conditions, ref])
}

function updateRef(index: number, patch: Partial<SegmentWorkspaceRef>): void {
	const ref = props.group.conditions[index] as SegmentWorkspaceRef
	replaceAt(index, { ...ref, ...patch })
}

function countAt(index: number): number | undefined {
	return props.counts[childPath(props.path, index)]
}
</script>

<template>
	<div class="flex flex-col gap-1">
		<template v-for="(node, index) in group.conditions" :key="index">
			<div
				v-if="isSegmentWorkspaceRef(node)"
				class="border-primary/30 bg-primary/5 my-1 rounded-lg border p-3"
			>
				<div class="flex flex-wrap items-center gap-2">
					<span
						class="text-dimmed w-12 shrink-0 font-mono text-[10.5px] font-semibold uppercase tracking-wider"
					>
						{{ joinLabel(index) }}
					</span>
					<DmsIconWell icon="i-ph-buildings" tone="primary" size="2xs" />
					<b class="text-highlighted text-sm">
						{{ $t('saas.segments.conditions.workspace_ref_label') }}
					</b>
					<USelect
						:model-value="node.role ?? 'member'"
						:items="roleItems"
						:disabled="disabled"
						size="sm"
						class="min-w-28"
						@update:model-value="
							updateRef(index, { role: $event as SegmentMemberRole })
						"
					/>
					<USelect
						:model-value="node.quantifier"
						:items="quantifierItems"
						:disabled="disabled"
						size="sm"
						class="min-w-40"
						@update:model-value="
							updateRef(index, { quantifier: $event as SegmentQuantifier })
						"
					/>
					<span class="text-muted text-sm">
						{{ $t('saas.segments.rules.where') }}
					</span>
					<span
						v-if="countAt(index) !== undefined"
						class="text-muted ms-auto font-mono text-[11px] tabular-nums"
					>
						{{ $t(countLabel, { count: countAt(index) }, countAt(index)!) }}
					</span>
					<template v-if="!disabled">
						<UButton
							:class="countAt(index) === undefined ? 'ms-auto' : ''"
							color="neutral"
							variant="ghost"
							icon="i-ph-copy"
							size="xs"
							:aria-label="$t('saas.segments.builder.duplicate_block')"
							@click="duplicateAt(index)"
						/>
						<UButton
							color="neutral"
							variant="ghost"
							icon="i-ph-x"
							size="xs"
							:aria-label="$t('saas.segments.builder.remove_block')"
							@click="removeAt(index)"
						/>
					</template>
				</div>
				<div class="mt-2 ps-4">
					<DmsSaasSegmentConditionsGroup
						:group="node.conditions"
						scope="workspace"
						:catalog="catalog"
						:path="childPath(path, index)"
						:depth="depth + 1"
						:counts="counts"
						:disabled="disabled"
						@update="updateRef(index, { conditions: $event })"
					/>
				</div>
			</div>
			<div
				v-else-if="isSegmentGroup(node)"
				class="border-default bg-elevated/40 my-1 rounded-lg border p-3"
			>
				<div class="flex flex-wrap items-center gap-2">
					<span
						class="text-dimmed w-12 shrink-0 font-mono text-[10.5px] font-semibold uppercase tracking-wider"
					>
						{{ joinLabel(index) }}
					</span>
					<DmsSaasSegmentLogicToggle
						:model-value="node.logical"
						:disabled="disabled"
						@update:model-value="replaceAt(index, { ...node, logical: $event })"
					/>
					<span class="text-muted text-sm">
						{{ $t('saas.segments.builder.of_these_conditions') }}
					</span>
					<UButton
						v-if="!disabled"
						class="ms-auto"
						color="neutral"
						variant="ghost"
						icon="i-ph-x"
						size="xs"
						:aria-label="$t('saas.segments.builder.remove_group')"
						@click="removeAt(index)"
					/>
				</div>
				<div class="mt-2 ps-4">
					<DmsSaasSegmentConditionsGroup
						:group="node"
						:scope="scope"
						:catalog="catalog"
						:path="childPath(path, index)"
						:depth="depth + 1"
						:counts="counts"
						:disabled="disabled"
						@update="replaceAt(index, $event)"
					/>
				</div>
			</div>
			<DmsSaasSegmentConditionRow
				v-else
				:condition="node as SegmentCondition"
				:fields="fields"
				:plans="plans"
				:catalog="catalog"
				:join-label="joinLabel(index)"
				:count="countAt(index)"
				:count-label="countLabel"
				:disabled="disabled"
				@update="replaceAt(index, $event)"
				@remove="removeAt(index)"
			/>
		</template>

		<p v-if="group.conditions.length === 0" class="text-dimmed py-1 text-sm">
			{{
				scope === 'user'
					? $t('saas.segments.builder.empty_rules')
					: $t('saas.segments.builder.empty_workspace_rules')
			}}
		</p>

		<div v-if="!disabled" class="flex flex-wrap gap-2 pt-2">
			<UButton
				variant="soft"
				color="neutral"
				icon="i-ph-plus"
				size="xs"
				@click="addCondition"
			>
				{{ $t('saas.segments.conditions.add') }}
			</UButton>
			<UButton
				v-if="canNest"
				variant="ghost"
				color="neutral"
				icon="i-ph-brackets-curly"
				size="xs"
				@click="addGroup"
			>
				{{ $t('saas.segments.conditions.add_group') }}
			</UButton>
			<UButton
				v-if="scope === 'user' && canNest"
				variant="ghost"
				color="primary"
				icon="i-ph-buildings"
				size="xs"
				@click="addWorkspaceRef"
			>
				{{ $t('saas.segments.conditions.add_workspace_ref') }}
			</UButton>
		</div>
	</div>
</template>
