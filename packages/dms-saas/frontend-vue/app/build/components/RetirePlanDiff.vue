<script setup lang="ts">
/**
 * What moving a retired plan's workspaces onto the target changes: each
 * feature that differs, the member cap, the permissions, and the features
 * left as they were.
 */
import { computed } from 'vue'
import {
	type CatalogFeature,
	isFeatureIncluded,
	PLAN_UNLIMITED,
} from '../plan-catalog'
import {
	changedFeatures,
	type PlanChangeKind,
	type RetireFeatureChange,
	type RetirePreparation,
	unchangedFeatureIds,
} from '../plan-retire'

const KIND_ICONS: Record<PlanChangeKind, string> = {
	lost: 'i-ph-minus-circle',
	gained: 'i-ph-plus-circle',
	changed: 'i-ph-arrows-left-right',
	same: 'i-ph-equals',
}

const KIND_CLASSES: Record<PlanChangeKind, string> = {
	lost: 'text-error',
	gained: 'text-success',
	changed: 'text-info',
	same: 'text-muted',
}

const props = defineProps<{
	preparation: RetirePreparation
	features: CatalogFeature[]
	planName: string
	targetName: string
}>()

const { t } = useI18n()
const { formatFeatureValue } = usePlanFeatureFormat()

const featuresById = computed(
	() => new Map(props.features.map((feature) => [feature._id, feature])),
)
const changes = computed(() => changedFeatures(props.preparation.features))
const unchanged = computed(() =>
	unchangedFeatureIds(props.preparation.features)
		.map((id) => featuresById.value.get(id)?.displayName)
		.filter((name): name is string => !!name),
)

function readValue(change: RetireFeatureChange, value: unknown): string {
	const feature = featuresById.value.get(change.featureId)
	if (
		!feature ||
		feature.valueType === 'boolean' ||
		!isFeatureIncluded(value)
	) {
		return isFeatureIncluded(value)
			? t('saas.catalog.retire.included')
			: t('saas.catalog.retire.not_included')
	}
	return formatFeatureValue({ ...feature, featureId: feature._id }, value)
}

function featureName(featureId: string): string {
	return featuresById.value.get(featureId)?.displayName ?? featureId
}

function memberCap(value: number): string {
	return value === PLAN_UNLIMITED
		? t('saas.catalog.plans.unlimited')
		: String(value)
}
</script>

<template>
	<DmsCard :padded="false">
		<div
			class="border-default flex items-center justify-between border-b px-4 py-2.5"
		>
			<span class="text-muted text-xs font-semibold uppercase">
				{{ $t('saas.catalog.retire.diff_title') }}
			</span>
			<span class="text-dimmed text-xs">{{ planName }} → {{ targetName }}</span>
		</div>
		<ul class="divide-default divide-y text-sm">
			<li
				v-for="change in changes"
				:key="change.featureId"
				class="flex items-center gap-2 px-4 py-2"
			>
				<UIcon
					:name="KIND_ICONS[change.kind]"
					class="size-4 shrink-0"
					:class="KIND_CLASSES[change.kind]"
				/>
				<span class="min-w-0 flex-1 truncate">
					{{ featureName(change.featureId) }}
				</span>
				<span class="text-muted text-xs">
					{{ readValue(change, change.from) }} →
					<b class="text-default">
						{{ readValue(change, change.to) }}
					</b>
				</span>
			</li>
			<li
				v-if="preparation.members.kind !== 'same'"
				class="flex flex-wrap items-center gap-2 px-4 py-2"
			>
				<UIcon
					:name="KIND_ICONS[preparation.members.kind]"
					class="size-4 shrink-0"
					:class="KIND_CLASSES[preparation.members.kind]"
				/>
				<span class="flex-1">
					{{ $t('saas.catalog.retire.members') }}
				</span>
				<span class="text-muted text-xs tabular-nums">
					{{ memberCap(preparation.members.from) }} →
					<b class="text-default">
						{{ memberCap(preparation.members.to) }}
					</b>
				</span>
				<small
					v-if="preparation.members.above > 0"
					class="text-warning w-full pl-6 text-xs"
				>
					{{
						$t(
							'saas.catalog.retire.above_cap',
							{
								count: preparation.members.above,
								cap: preparation.members.to,
							},
							preparation.members.above,
						)
					}}
				</small>
			</li>
			<li
				v-if="preparation.permissions.length > 0"
				class="flex items-center gap-2 px-4 py-2"
			>
				<UIcon name="i-ph-key" class="text-info size-4 shrink-0" />
				<span class="flex-1">
					{{
						$t('saas.catalog.retire.permissions_changed', {
							added: preparation.permissions.filter(
								(row) => row.kind === 'gained',
							).length,
							removed: preparation.permissions.filter(
								(row) => row.kind === 'lost',
							).length,
						})
					}}
				</span>
			</li>
			<li
				v-if="unchanged.length > 0"
				class="text-muted flex items-center gap-2 px-4 py-2"
			>
				<UIcon :name="KIND_ICONS.same" class="size-4 shrink-0" />
				<span class="flex-1">
					{{
						$t('saas.catalog.retire.unchanged', {
							names: unchanged.join(', '),
						})
					}}
				</span>
			</li>
		</ul>
	</DmsCard>
</template>
