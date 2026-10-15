<script setup lang="ts">
import { computed } from 'vue'
import {
	type CatalogFeature,
	type CatalogPlanRow,
	type PlanCardAction,
	type PlanCardReorder,
	type PlanCardTableActions,
	cardFeatures,
	cardPriceSuffixKey,
	formatPlanAmount,
	monthlyEquivalent,
	PLAN_UNLIMITED,
} from '../build/plan-catalog'

const FEATURE_PREVIEW_LIMIT = 5
const PERCENT = 100
const SHARE_FRACTION_DIGITS = 1
const STOP_SELLING_ID = 'stop_selling'
const PUT_ON_SALE_ID = 'put_on_sale'
const RETIRE_ID = 'retire'

// The card of the plans' `cards` display. Besides the props it reads, the
// display hands it the table's columns and label key: kept off the root
// element, which they would land on as attributes.
defineOptions({ inheritAttrs: false })

const props = withDefaults(
	defineProps<{
		row: CatalogPlanRow
		rowId: string
		actions: PlanCardTableActions
		selected?: boolean
		select: (value?: boolean) => void
		open: () => void
		reorder?: PlanCardReorder
		/** The table selects rows (card option, as `rowActions.hasSelection`). */
		selectable?: boolean
	}>(),
	{ selected: false, reorder: undefined, selectable: false },
)

const { t, locale } = useI18n()
const { processI18n } = useTranslation()
const planDescription = usePlanDescription()
const { formatFeatureValue } = usePlanFeatureFormat()
const catalog = usePlanCatalog()

const plan = computed(() => props.row)
const canEdit = computed(() => props.actions.canEditRow(props.row))
const titleId = computed(() => `plan-card-${props.rowId}`)
const allowedActions = computed(() => props.actions.customFor(props.row))
const saleAction = computed(() =>
	allowedActions.value.find(
		(action) =>
			action.id === (plan.value.isActive ? STOP_SELLING_ID : PUT_ON_SALE_ID),
	),
)
const retireAction = computed(() =>
	allowedActions.value.find((action) => action.id === RETIRE_ID),
)
const isLegacy = computed(() => !plan.value.isActive)
const isSeatPlan = computed(() => plan.value.billingMode === 'seat')
const isFree = computed(() => plan.value.price === 0)

const amount = computed(() =>
	formatPlanAmount(plan.value.price, plan.value.currency, locale.value),
)

const priceSuffix = computed(() => t(cardPriceSuffixKey(plan.value)))

const priceNote = computed(() => {
	if (isFree.value) return t('saas.catalog.plans.card.note_free')
	const mode = t(`saas.catalog.plans.billing_mode.${plan.value.billingMode}`)
	if (plan.value.interval !== 'year') {
		return t('saas.catalog.plans.card.note', { mode })
	}
	const monthly = formatPlanAmount(
		monthlyEquivalent(plan.value),
		plan.value.currency,
		locale.value,
	)
	return t('saas.catalog.plans.card.note_yearly', { mode, monthly })
})

// The position itself is the card's place: a move by hand stores a value
// between its neighbours', no rank to show.
const subtitle = computed(() => {
	if (isLegacy.value) return t('saas.catalog.plans.card.not_on_sale')
	return plan.value.isPublic
		? t('saas.catalog.plans.card.public')
		: t('saas.catalog.plans.card.hidden')
})

const chips = computed(() => [
	{
		icon: 'i-ph-hourglass',
		label:
			plan.value.trialDays > 0
				? t('saas.catalog.plans.card.trial', { days: plan.value.trialDays })
				: t('saas.catalog.plans.card.no_trial'),
	},
	{
		icon: plan.value.audience === 'business' ? 'i-ph-buildings' : 'i-ph-user',
		label: t(`saas.catalog.plans.audience.${plan.value.audience}`),
	},
	{
		icon: 'i-ph-users',
		label:
			plan.value.maxMembers === PLAN_UNLIMITED
				? t('saas.catalog.plans.card.members_unlimited')
				: t(
						'saas.catalog.plans.card.members',
						{ count: plan.value.maxMembers },
						plan.value.maxMembers,
					),
	},
])

const workspacesDetail = computed(() => {
	const count = plan.value.workspaceCount
	const base = t('saas.catalog.plans.card.workspaces', { count }, count)
	if (isSeatPlan.value) {
		return `${base} · ${t('saas.catalog.plans.card.seats', { count: plan.value.seatCount }, plan.value.seatCount)}`
	}
	if (isLegacy.value) {
		return `${base} · ${t('saas.catalog.plans.card.members_count', { count: plan.value.memberCount }, plan.value.memberCount)}`
	}
	return base
})

const mrr = computed(() =>
	formatPlanAmount(plan.value.mrr, plan.value.currency, locale.value),
)
const mrrShare = computed(() =>
	new Intl.NumberFormat(locale.value, {
		maximumFractionDigits: SHARE_FRACTION_DIGITS,
	}).format((plan.value.mrrShare ?? 0) * PERCENT),
)

const features = computed(() =>
	cardFeatures(
		catalog.data.value?.features ?? [],
		plan.value.resolvedFeatures ?? [],
		FEATURE_PREVIEW_LIMIT,
	),
)

function featureValue(entry: {
	feature: CatalogFeature
	value: unknown
}): string {
	if (entry.feature.valueType === 'boolean') return ''
	return formatFeatureValue(
		{ ...entry.feature, featureId: entry.feature._id },
		entry.value,
		plan.value.currency,
	)
}

const menuItems = computed(() => [
	[
		{
			label: t('saas.catalog.plans.action.edit'),
			icon: 'i-ph-pencil-simple',
			disabled: !canEdit.value,
			onSelect: edit,
		},
		...allowedActions.value
			.filter(
				(action) => action.color !== 'error' && action.color !== 'warning',
			)
			.map(toMenuItem),
	],
	allowedActions.value
		.filter((action) => action.color === 'error' || action.color === 'warning')
		.map(toMenuItem),
])

function toMenuItem(action: PlanCardAction) {
	return {
		label: processI18n(action.label),
		icon: action.icon,
		color: action.color === 'error' ? ('error' as const) : undefined,
		onSelect: () => run(action),
	}
}

function edit(): void {
	props.actions.edit(props.row)
}

function run(action: PlanCardAction): void {
	props.actions.custom(action, props.row)
}

function toggleSale(): void {
	if (saleAction.value) run(saleAction.value)
}

// Every card asks as it mounts: the cards of a page share the one request.
</script>

<template>
	<DmsCard
		as="article"
		class="relative h-full"
		:class="{
			'opacity-80': isLegacy && !reorder?.dragging,
			'opacity-50': reorder?.dragging,
			'ring-primary ring-2': selected,
		}"
		:selected="!!plan.borderLabel && !isLegacy"
		:aria-labelledby="titleId"
	>
		<div class="flex h-full flex-col gap-4">
			<div class="flex items-start gap-2">
				<button
					v-if="reorder"
					v-bind="reorder.handle"
					class="text-dimmed hover:text-highlighted focus-visible:outline-primary -ml-1 inline-flex size-6 shrink-0 cursor-grab items-center justify-center rounded focus-visible:outline-2 disabled:cursor-not-allowed disabled:opacity-40"
				>
					<UIcon name="i-ph-dots-six-vertical" class="size-4" />
				</button>
				<UCheckbox
					v-if="selectable"
					class="pt-1"
					:model-value="selected"
					:aria-label="plan.name"
					@update:model-value="select(!!$event)"
				/>
				<div class="min-w-0 flex-1">
					<!-- Wraps rather than truncates: a Legacy or Popular badge next to a
					longer name moves under it instead of cutting the name. -->
					<div class="flex flex-wrap items-center gap-x-2 gap-y-1">
						<h3
							:id="titleId"
							class="text-highlighted truncate text-base font-semibold"
						>
							<button
								type="button"
								class="hover:underline focus-visible:underline"
								@click="open()"
							>
								{{ plan.name }}
							</button>
						</h3>
						<UBadge
							v-if="isLegacy"
							size="sm"
							variant="soft"
							color="warning"
							icon="i-ph-clock-counter-clockwise"
						>
							{{ $t('saas.catalog.plans.card.legacy') }}
						</UBadge>
						<UBadge
							v-else-if="plan.borderLabel"
							size="sm"
							variant="soft"
							color="primary"
							icon="i-ph-star"
						>
							{{ plan.borderLabel }}
						</UBadge>
					</div>
					<p class="text-muted text-xs">{{ subtitle }}</p>
				</div>
				<USwitch
					:model-value="plan.isActive"
					:disabled="!saleAction"
					:aria-label="$t('saas.catalog.plans.card.on_sale')"
					@update:model-value="toggleSale"
				/>
			</div>

			<p v-if="plan.description" class="text-muted line-clamp-2 text-sm">
				{{ planDescription(plan.description) }}
			</p>

			<div>
				<div class="flex items-baseline gap-1">
					<span class="text-highlighted text-3xl font-bold tabular-nums">
						{{ amount }}
					</span>
					<span class="text-muted text-sm">{{ priceSuffix }}</span>
				</div>
				<p class="text-dimmed mt-0.5 text-xs">{{ priceNote }}</p>
			</div>

			<div class="flex flex-wrap gap-1.5">
				<span
					v-for="chip in chips"
					:key="chip.label"
					class="border-default text-toned inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs"
				>
					<UIcon :name="chip.icon" class="size-3.5" />
					{{ chip.label }}
				</span>
			</div>

			<div
				class="bg-elevated/50 grid grid-cols-2 gap-2 rounded-lg p-3"
				:class="{
					'ring-warning/40 ring-1': isLegacy && plan.workspaceCount > 0,
				}"
			>
				<div>
					<p class="text-highlighted font-semibold tabular-nums">
						{{ plan.workspaceCount }}
					</p>
					<p class="text-muted text-xs">{{ workspacesDetail }}</p>
				</div>
				<div>
					<p class="text-highlighted font-semibold tabular-nums">{{ mrr }}</p>
					<p class="text-muted text-xs">
						{{ $t('saas.catalog.plans.card.mrr_share', { share: mrrShare }) }}
					</p>
				</div>
			</div>

			<p
				v-if="catalog.status.value === 'error'"
				class="text-muted flex items-center gap-1.5 text-xs"
			>
				<UIcon name="i-ph-warning" class="text-warning size-4" />
				{{ $t('saas.catalog.plans.features_failed') }}
				<UButton
					size="xs"
					variant="link"
					color="neutral"
					:label="$t('saas.common.retry')"
					@click="catalog.refresh()"
				/>
			</p>
			<ul v-else-if="features.length" class="flex flex-col gap-1.5 text-sm">
				<li
					v-for="entry in features"
					:key="entry.feature._id"
					class="flex items-center gap-2"
					:class="{ 'text-dimmed': !entry.isIncluded }"
				>
					<UIcon
						:name="entry.isIncluded ? 'i-ph-check' : 'i-ph-x'"
						class="size-4 shrink-0"
						:class="entry.isIncluded ? 'text-success' : ''"
					/>
					<span class="truncate">{{ entry.feature.displayName }}</span>
					<span
						v-if="entry.isIncluded && featureValue(entry)"
						class="text-muted ml-auto text-xs tabular-nums"
					>
						{{ featureValue(entry) }}
					</span>
				</li>
			</ul>

			<div class="mt-auto flex items-center gap-2 pt-1">
				<UButton
					size="sm"
					color="neutral"
					variant="outline"
					icon="i-ph-pencil-simple"
					:disabled="!canEdit"
					@click="edit"
				>
					{{ $t('saas.catalog.plans.action.edit') }}
				</UButton>
				<UButton
					v-if="isLegacy && retireAction"
					size="sm"
					color="warning"
					variant="outline"
					icon="i-ph-archive"
					@click="run(retireAction)"
				>
					{{ $t('saas.catalog.plans.action.retire') }}
				</UButton>
				<UDropdownMenu :items="menuItems" class="ml-auto">
					<UButton
						size="sm"
						color="neutral"
						variant="ghost"
						icon="i-ph-dots-three"
						:aria-label="$t('saas.catalog.plans.card.more')"
					/>
				</UDropdownMenu>
			</div>
		</div>
	</DmsCard>
</template>
