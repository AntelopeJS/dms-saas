<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import {
	type CatalogFeature,
	type CatalogPlanRow,
	type PlanCardAction,
	type PlanCatalog,
	PLANS_ENDPOINT,
	PLANS_PAGE_URL,
	reorderPositions,
} from '../build/plan-catalog'

interface CardsContext {
	items: CatalogPlanRow[]
	loading: boolean
	query: Record<string, unknown>
	options?: { actions?: PlanCardAction[] }
	actions: {
		canEdit: boolean
		edit: (item: CatalogPlanRow) => void
		custom: (action: PlanCardAction, item?: CatalogPlanRow) => void
	}
	refresh: () => void | Promise<void>
}

type EmptyKind = 'filtered' | 'legacy' | 'on_sale' | 'first_run'

const SKELETON_CARDS = 3
const SALE_FILTER_KEY = 'filter_isActive'
const LEGACY_FILTER = 'is:false'
const ON_SALE_FILTER = 'is:true'

const props = defineProps<{ context: CardsContext }>()

const { $authFetch } = useAuthFetch()
const { t } = useI18n()
const toast = useToast()
const { resolveApiError } = useApiErrorMessage()

const features = ref<CatalogFeature[]>([])
const hasFeaturesError = ref(false)
const draggedId = ref<string | null>(null)
const pendingOrder = ref<CatalogPlanRow[] | null>(null)

const plans = computed<CatalogPlanRow[]>(
	() => pendingOrder.value ?? props.context.items,
)
const search = computed(() => String(props.context.query.search ?? '').trim())
const canReorder = computed(
	() => props.context.actions.canEdit && search.value.length === 0,
)
const cardActions = computed(() => props.context.options?.actions ?? [])

const emptyKind = computed<EmptyKind>(() => {
	if (search.value) return 'filtered'
	const saleFilter = props.context.query[SALE_FILTER_KEY]
	if (saleFilter === LEGACY_FILTER) return 'legacy'
	if (saleFilter === ON_SALE_FILTER) return 'on_sale'
	return 'first_run'
})
const hasCreateAction = computed(() => emptyKind.value !== 'legacy')

async function loadFeatures(): Promise<void> {
	hasFeaturesError.value = false
	try {
		const catalog = await $authFetch<PlanCatalog>(`${PLANS_ENDPOINT}/catalog`)
		features.value = catalog.features
	} catch {
		hasFeaturesError.value = true
	}
}

function onDragStart(plan: CatalogPlanRow): void {
	draggedId.value = plan._id
}

function moveBefore(targetId: string): CatalogPlanRow[] | null {
	const list = [...plans.value]
	const from = list.findIndex((plan) => plan._id === draggedId.value)
	const to = list.findIndex((plan) => plan._id === targetId)
	if (from < 0 || to < 0 || from === to) return null
	const [moved] = list.splice(from, 1)
	if (!moved) return null
	list.splice(to, 0, moved)
	return list
}

async function onDrop(targetId: string): Promise<void> {
	const reordered = moveBefore(targetId)
	draggedId.value = null
	if (!reordered) return
	const items = reorderPositions(props.context.items, reordered)
	pendingOrder.value = reordered
	try {
		await $authFetch(`${PLANS_ENDPOINT}/reorder`, {
			method: 'POST',
			body: { items },
		})
		await props.context.refresh()
	} catch (error) {
		toast.add({
			color: 'error',
			icon: 'i-ph-warning-circle',
			title: t('saas.catalog.plans.reorder_failed'),
			description: resolveApiError(
				error,
				'saas.catalog.plans.reorder_failed_hint',
			),
		})
	} finally {
		pendingOrder.value = null
	}
}

function runAction(action: PlanCardAction, plan: CatalogPlanRow): void {
	props.context.actions.custom(action, plan)
}

onMounted(loadFeatures)
defineExpose({ refresh: loadFeatures })
</script>

<template>
	<div class="flex flex-col gap-3">
		<p
			v-if="canReorder && plans.length > 1"
			class="text-muted flex items-center gap-1.5 text-xs"
		>
			<UIcon name="i-ph-dots-six-vertical" class="size-4" />
			{{ $t('saas.catalog.plans.reorder_hint') }}
		</p>
		<UAlert
			v-if="hasFeaturesError"
			color="warning"
			variant="subtle"
			icon="i-ph-warning"
			:title="$t('saas.catalog.plans.features_failed')"
		>
			<template #actions>
				<UButton
					size="xs"
					variant="soft"
					color="warning"
					icon="i-ph-arrow-clockwise"
					@click="loadFeatures"
				>
					{{ $t('saas.common.retry') }}
				</UButton>
			</template>
		</UAlert>

		<div
			v-if="context.loading && plans.length === 0"
			class="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-4"
		>
			<USkeleton
				v-for="index in SKELETON_CARDS"
				:key="index"
				class="h-80 w-full rounded-xl"
			/>
		</div>

		<DmsCard v-else-if="plans.length === 0">
			<DmsEmptyState
				:icon="
					emptyKind === 'filtered' ? 'i-ph-magnifying-glass' : 'i-ph-stack'
				"
				:variant="emptyKind === 'filtered' ? 'no-result' : 'no-data'"
				:title="
					$t(`saas.catalog.plans.empty_display.${emptyKind}_title`, { search })
				"
				:description="
					$t(`saas.catalog.plans.empty_display.${emptyKind}_description`)
				"
			>
				<template v-if="hasCreateAction" #actions>
					<UButton icon="i-ph-plus" :to="`${PLANS_PAGE_URL}/new`">
						{{ $t('saas.catalog.plans.create') }}
					</UButton>
				</template>
			</DmsEmptyState>
		</DmsCard>

		<div
			v-else
			class="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-4"
		>
			<div
				v-for="plan in plans"
				:key="plan._id"
				:class="{ 'opacity-50': draggedId === plan._id }"
				@dragover.prevent
				@drop="onDrop(plan._id)"
			>
				<DmsSaasPlanCard
					:plan="plan"
					:features="features"
					:actions="cardActions"
					:draggable="canReorder"
					:can-edit="context.actions.canEdit"
					@drag-start="onDragStart(plan)"
					@edit="context.actions.edit(plan)"
					@action="(action: PlanCardAction) => runAction(action, plan)"
				/>
			</div>
			<ULink
				:to="`${PLANS_PAGE_URL}/new`"
				class="border-default text-muted hover:border-accented hover:text-default flex min-h-48 flex-col items-center justify-center gap-2 rounded-xl border border-dashed p-6 text-center transition-colors"
			>
				<DmsIconWell icon="i-ph-plus" tone="muted" />
				<span class="text-highlighted text-sm font-semibold">
					{{ $t('saas.catalog.plans.create') }}
				</span>
				<span class="text-xs">{{ $t('saas.catalog.plans.create_hint') }}</span>
			</ULink>
		</div>
	</div>
</template>
