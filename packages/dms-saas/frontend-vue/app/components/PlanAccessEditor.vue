<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import PlanFeatureValueInput from '../build/PlanFeatureValueInput.vue'
import PlanPermissionPicker from '../build/PlanPermissionPicker.vue'
import type { CatalogFeature, PlanCatalog } from '../build/plan-catalog'
import {
	flattenPermissionTree,
	type PermissionNode,
} from '../build/plan-permissions'

interface PlanAccess {
	parentPlanId: string | null
	extraPermissions: string[]
	extraFeatures: Record<string, unknown>
}

type FeatureSource = 'inherited' | 'overridden' | 'own' | 'unset'

const FEATURES_PAGE_URL = '/modules/saas/catalog/features'
const NO_PARENT = '__none__'

const props = defineProps<{
	modelValue?: PlanAccess | string | null
	disabled?: boolean
	routeParams?: Record<string, string>
	catalogUrl?: string
	permissionsTreeUrl?: string
}>()

const emit = defineEmits<{ 'update:modelValue': [value: PlanAccess] }>()

const { $authFetch } = useAuthFetch()
const { t } = useI18n()
const { processI18n } = useTranslation()
const { formatFeatureValue } = usePlanFeatureFormat()

const catalog = ref<PlanCatalog>({ plans: [], features: [] })
const tree = ref<PermissionNode[]>([])
const isLoading = ref(true)
const hasError = ref(false)
const isPickerOpen = ref(false)

function parseAccess(raw: PlanAccess | string | null | undefined): PlanAccess {
	let value: Partial<PlanAccess> | null = null
	if (typeof raw === 'string' && raw) {
		try {
			value = JSON.parse(raw) as PlanAccess
		} catch {
			value = null
		}
	} else if (raw && typeof raw === 'object') {
		value = raw
	}
	return {
		parentPlanId: value?.parentPlanId ?? null,
		extraPermissions: [...(value?.extraPermissions ?? [])],
		extraFeatures: { ...(value?.extraFeatures ?? {}) },
	}
}

const access = computed(() => parseAccess(props.modelValue))
const currentPlanId = computed(() => props.routeParams?.id)
const parent = computed(() =>
	catalog.value.plans.find((plan) => plan._id === access.value.parentPlanId),
)
const parentValues = computed(
	() =>
		new Map(
			(parent.value?.features ?? []).map((entry) => [
				entry.featureId,
				entry.value,
			]),
		),
)

/** Plans that can be a parent: not this one, nor one built on it. */
const parentItems = computed(() => [
	{ value: NO_PARENT, label: t('saas.catalog.editor.access.no_parent') },
	...catalog.value.plans
		.filter((plan) => plan._id !== currentPlanId.value)
		.filter(
			(plan) =>
				!currentPlanId.value || plan.inheritsFromPlanId !== currentPlanId.value,
		)
		.map((plan) => ({ value: plan._id, label: plan.name })),
])

function update(patch: Partial<PlanAccess>): void {
	emit('update:modelValue', { ...access.value, ...patch })
}

function setParent(value: string | undefined): void {
	update({ parentPlanId: !value || value === NO_PARENT ? null : value })
}

function sourceOf(feature: CatalogFeature): FeatureSource {
	const isOwn = feature._id in access.value.extraFeatures
	if (parent.value && parentValues.value.has(feature._id)) {
		return isOwn ? 'overridden' : 'inherited'
	}
	return isOwn ? 'own' : 'unset'
}

function valueOf(feature: CatalogFeature): unknown {
	if (feature._id in access.value.extraFeatures) {
		return access.value.extraFeatures[feature._id]
	}
	return parentValues.value.get(feature._id) ?? null
}

function setFeature(feature: CatalogFeature, value: unknown): void {
	update({
		extraFeatures: { ...access.value.extraFeatures, [feature._id]: value },
	})
}

function resetFeature(feature: CatalogFeature): void {
	const next = { ...access.value.extraFeatures }
	delete next[feature._id]
	update({ extraFeatures: next })
}

function parentValueLabel(feature: CatalogFeature): string {
	const value = parentValues.value.get(feature._id)
	if (feature.valueType === 'boolean') {
		return value === true
			? t('saas.catalog.editor.feature.included')
			: t('saas.catalog.editor.feature.not_included')
	}
	return formatFeatureValue({ ...feature, featureId: feature._id }, value)
}

const overriddenCount = computed(
	() =>
		catalog.value.features.filter(
			(feature) => sourceOf(feature) === 'overridden',
		).length,
)
const inheritedCount = computed(
	() =>
		catalog.value.features.filter(
			(feature) => sourceOf(feature) === 'inherited',
		).length,
)

const permissionIds = computed(() =>
	flattenPermissionTree(tree.value).map((row) => row.node.id),
)
const inheritedPermissions = computed(() => parent.value?.permissions ?? [])
const grantedPermissions = computed(() => {
	const granted = new Set([
		...access.value.extraPermissions,
		...inheritedPermissions.value,
	])
	return permissionIds.value.filter((id) => granted.has(id)).length
})
const addedPermissions = computed(() => {
	const inherited = new Set(inheritedPermissions.value)
	return access.value.extraPermissions.filter((id) => !inherited.has(id)).length
})
const permissionGroups = computed(() =>
	tree.value.map((group) => {
		const ids = [
			group.id,
			...flattenPermissionTree(group.children ?? []).map((row) => row.node.id),
		]
		const granted = new Set([
			...access.value.extraPermissions,
			...inheritedPermissions.value,
		])
		return {
			id: group.id,
			label: processI18n(group.label),
			count: `${ids.filter((id) => granted.has(id)).length}/${ids.length}`,
		}
	}),
)

const planName = computed(() => t('saas.catalog.editor.access.this_plan'))

async function load(): Promise<void> {
	isLoading.value = true
	hasError.value = false
	try {
		const [loadedCatalog, loadedTree] = await Promise.all([
			$authFetch<PlanCatalog>(props.catalogUrl ?? '/api/saas/plans/catalog'),
			$authFetch<PermissionNode[]>(
				props.permissionsTreeUrl ?? '/api/saas/plans/permissions-tree',
			),
		])
		catalog.value = loadedCatalog
		tree.value = loadedTree
	} catch {
		hasError.value = true
	} finally {
		isLoading.value = false
	}
}

onMounted(load)
</script>

<template>
	<div class="flex flex-col gap-4">
		<div v-if="isLoading" class="flex flex-col gap-2">
			<USkeleton v-for="index in 4" :key="index" class="h-10 w-full" />
		</div>
		<DmsSaasLoadFailure
			v-else-if="hasError"
			:title="$t('saas.catalog.editor.access.load_failed')"
			@retry="load"
		/>
		<template v-else>
			<div class="flex flex-col gap-1.5">
				<span class="text-highlighted text-sm font-medium">
					{{ $t('saas.catalog.editor.access.parent') }}
				</span>
				<USelect
					:model-value="access.parentPlanId ?? NO_PARENT"
					:items="parentItems"
					:disabled="disabled"
					class="w-full max-w-sm"
					@update:model-value="setParent"
				/>
				<p class="text-muted text-xs">
					{{
						parent
							? $t('saas.catalog.editor.access.parent_hint', {
									parent: parent.name,
								})
							: $t('saas.catalog.editor.access.no_parent_hint')
					}}
				</p>
			</div>

			<div class="border-default overflow-hidden rounded-lg border">
				<div
					class="bg-elevated/50 text-muted grid grid-cols-[minmax(0,1fr)_auto] gap-3 px-3 py-2 text-xs font-medium uppercase sm:grid-cols-[minmax(0,1fr)_auto_10rem]"
				>
					<span>{{ $t('saas.catalog.editor.access.feature') }}</span>
					<span>{{ $t('saas.catalog.editor.access.value') }}</span>
					<span class="hidden sm:block">
						{{ $t('saas.catalog.editor.access.source') }}
					</span>
				</div>
				<p
					v-if="catalog.features.length === 0"
					class="text-muted px-3 py-6 text-center text-sm"
				>
					{{ $t('saas.catalog.editor.access.no_features') }}
				</p>
				<div
					v-for="feature in catalog.features"
					:key="feature._id"
					class="border-default grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-t px-3 py-2.5 sm:grid-cols-[minmax(0,1fr)_auto_10rem]"
				>
					<div class="min-w-0">
						<p class="text-highlighted truncate text-sm font-medium">
							{{ feature.displayName }}
						</p>
						<p v-if="feature.description" class="text-muted truncate text-xs">
							{{ feature.description }}
						</p>
					</div>
					<PlanFeatureValueInput
						:value-type="feature.valueType"
						:model-value="valueOf(feature)"
						:unit="feature.unit"
						:disabled="disabled"
						@update:model-value="(value: unknown) => setFeature(feature, value)"
					/>
					<div
						class="col-span-2 flex items-center gap-1.5 text-xs sm:col-span-1"
					>
						<UBadge
							v-if="sourceOf(feature) === 'inherited'"
							size="sm"
							color="neutral"
							variant="soft"
						>
							{{
								$t('saas.catalog.editor.access.inherited', {
									parent: parent?.name ?? '',
								})
							}}
						</UBadge>
						<template v-else-if="sourceOf(feature) === 'overridden'">
							<UBadge size="sm" color="primary" variant="soft">
								{{ $t('saas.catalog.editor.access.overridden') }}
							</UBadge>
							<span class="text-dimmed truncate">
								{{ parent?.name }}: {{ parentValueLabel(feature) }}
							</span>
							<UButton
								size="xs"
								color="neutral"
								variant="ghost"
								square
								icon="i-ph-arrow-counter-clockwise"
								:disabled="disabled"
								:aria-label="$t('saas.catalog.editor.access.reset')"
								:title="$t('saas.catalog.editor.access.reset')"
								@click="resetFeature(feature)"
							/>
						</template>
						<span v-else-if="sourceOf(feature) === 'unset'" class="text-dimmed">
							{{ $t('saas.catalog.editor.access.unset') }}
						</span>
					</div>
				</div>
				<div
					class="bg-elevated/50 border-default flex items-center justify-between border-t px-3 py-2 text-xs"
				>
					<span class="text-muted">
						{{
							parent
								? $t('saas.catalog.editor.access.summary_parent', {
										count: catalog.features.length,
										overridden: overriddenCount,
										inherited: inheritedCount,
									})
								: $t(
										'saas.catalog.editor.access.summary',
										{ count: catalog.features.length },
										catalog.features.length,
									)
						}}
					</span>
					<ULink :to="FEATURES_PAGE_URL" class="text-primary font-medium">
						{{ $t('saas.catalog.editor.access.manage_features') }}
					</ULink>
				</div>
			</div>

			<div class="border-default flex flex-col gap-3 rounded-lg border p-3">
				<div class="flex flex-wrap items-center justify-between gap-2">
					<div>
						<p class="text-highlighted text-sm font-medium">
							{{ $t('saas.catalog.editor.access.permissions') }}
						</p>
						<p class="text-muted text-xs">
							{{
								parent
									? $t('saas.catalog.editor.access.permissions_parent', {
											granted: grantedPermissions,
											total: permissionIds.length,
											parent: parent.name,
											added: addedPermissions,
										})
									: $t('saas.catalog.editor.access.permissions_summary', {
											granted: grantedPermissions,
											total: permissionIds.length,
										})
							}}
						</p>
					</div>
					<UButton
						size="sm"
						color="neutral"
						variant="outline"
						icon="i-ph-key"
						:disabled="disabled"
						@click="isPickerOpen = true"
					>
						{{ $t('saas.catalog.editor.access.edit_permissions') }}
					</UButton>
				</div>
				<div class="flex flex-wrap gap-1.5">
					<span
						v-for="group in permissionGroups"
						:key="group.id"
						class="border-default text-toned inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs"
					>
						{{ group.label }}
						<span class="text-muted tabular-nums">{{ group.count }}</span>
					</span>
				</div>
			</div>

			<PlanPermissionPicker
				v-model:open="isPickerOpen"
				:plan-name="planName"
				:parent-name="parent?.name ?? null"
				:tree="tree"
				:own="access.extraPermissions"
				:inherited="inheritedPermissions"
				@apply="
					(permissions: string[]) => update({ extraPermissions: permissions })
				"
			/>
		</template>
	</div>
</template>
