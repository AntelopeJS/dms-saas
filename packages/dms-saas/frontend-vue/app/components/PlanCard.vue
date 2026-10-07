<script setup lang="ts">
import { computed } from 'vue'
import {
	type CatalogFeature,
	type CatalogPlanRow,
	type PlanCardAction,
	cardFeatures,
	formatPlanAmount,
	isActionAllowed,
	monthlyEquivalent,
} from '../build/plan-catalog'

const FEATURE_PREVIEW_LIMIT = 5
const PERCENT = 100
const SHARE_FRACTION_DIGITS = 1
const STOP_SELLING_KEY = 'stop_selling'
const PUT_ON_SALE_KEY = 'put_on_sale'
const RETIRE_KEY = 'retire'
const UNLIMITED_MEMBERS = -1

const props = defineProps<{
	plan: CatalogPlanRow
	features: CatalogFeature[]
	actions: PlanCardAction[]
	draggable: boolean
	canEdit: boolean
}>()

const emit = defineEmits<{
	dragStart: []
	edit: []
	action: [action: PlanCardAction]
}>()

const { t, locale } = useI18n()
const planDescription = usePlanDescription()
const { formatFeatureValue } = usePlanFeatureFormat()

const row = computed(() => props.plan as unknown as Record<string, unknown>)
const allowedActions = computed(() =>
	props.actions.filter((action) => isActionAllowed(action, row.value)),
)
const saleAction = computed(() =>
	allowedActions.value.find(
		(action) =>
			action.key === (props.plan.isActive ? STOP_SELLING_KEY : PUT_ON_SALE_KEY),
	),
)
const retireAction = computed(() =>
	allowedActions.value.find((action) => action.key === RETIRE_KEY),
)
const isLegacy = computed(() => !props.plan.isActive)
const isSeatPlan = computed(() => props.plan.billingMode === 'seat')
const isFree = computed(() => props.plan.price === 0)

const amount = computed(() =>
	formatPlanAmount(props.plan.price, props.plan.currency, locale.value),
)

const priceSuffix = computed(() => {
	if (isFree.value) return t('saas.catalog.plans.card.forever')
	const key = isSeatPlan.value ? 'per_seat' : 'per'
	return t(`saas.catalog.plans.card.${key}_${props.plan.interval}`)
})

const priceNote = computed(() => {
	if (isFree.value) return t('saas.catalog.plans.card.note_free')
	const mode = t(`saas.catalog.plans.billing_mode.${props.plan.billingMode}`)
	if (props.plan.interval !== 'year') {
		return t('saas.catalog.plans.card.note', { mode })
	}
	const monthly = formatPlanAmount(
		monthlyEquivalent(props.plan),
		props.plan.currency,
		locale.value,
	)
	return t('saas.catalog.plans.card.note_yearly', { mode, monthly })
})

const subtitle = computed(() => {
	if (isLegacy.value) return t('saas.catalog.plans.card.not_on_sale')
	const visibility = props.plan.isPublic
		? t('saas.catalog.plans.card.public')
		: t('saas.catalog.plans.card.hidden')
	return t('saas.catalog.plans.card.order', {
		order: (props.plan.order ?? 0) + 1,
		visibility,
	})
})

const chips = computed(() => [
	{
		icon: 'i-ph-hourglass',
		label:
			props.plan.trialDays > 0
				? t('saas.catalog.plans.card.trial', { days: props.plan.trialDays })
				: t('saas.catalog.plans.card.no_trial'),
	},
	{
		icon: props.plan.audience === 'business' ? 'i-ph-buildings' : 'i-ph-user',
		label: t(`saas.catalog.plans.audience.${props.plan.audience}`),
	},
	{
		icon: 'i-ph-users',
		label:
			props.plan.maxMembers === UNLIMITED_MEMBERS
				? t('saas.catalog.plans.card.members_unlimited')
				: t(
						'saas.catalog.plans.card.members',
						{ count: props.plan.maxMembers },
						props.plan.maxMembers,
					),
	},
])

const workspacesDetail = computed(() => {
	const count = props.plan.workspaceCount
	const base = t('saas.catalog.plans.card.workspaces', { count }, count)
	if (isSeatPlan.value) {
		return `${base} · ${t('saas.catalog.plans.card.seats', { count: props.plan.seatCount }, props.plan.seatCount)}`
	}
	if (isLegacy.value) {
		return `${base} · ${t('saas.catalog.plans.card.members_count', { count: props.plan.memberCount }, props.plan.memberCount)}`
	}
	return base
})

const mrr = computed(() =>
	formatPlanAmount(props.plan.mrr, props.plan.currency, locale.value),
)
const mrrShare = computed(() =>
	new Intl.NumberFormat(locale.value, {
		maximumFractionDigits: SHARE_FRACTION_DIGITS,
	}).format((props.plan.mrrShare ?? 0) * PERCENT),
)

const features = computed(() =>
	cardFeatures(
		props.features,
		props.plan.resolvedFeatures ?? [],
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
		props.plan.currency,
	)
}

const menuItems = computed(() => [
	[
		{
			label: t('saas.catalog.plans.action.edit'),
			icon: 'i-ph-pencil-simple',
			disabled: !props.canEdit,
			onSelect: () => emit('edit'),
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
		label: t(action.label.replace(/^\$/, '')),
		icon: action.icon,
		color: action.color === 'error' ? ('error' as const) : undefined,
		onSelect: () => emit('action', action),
	}
}

function toggleSale(): void {
	if (saleAction.value) emit('action', saleAction.value)
}
</script>

<template>
	<DmsCard
		class="relative h-full"
		:class="{ 'opacity-80': isLegacy }"
		:selected="!!plan.borderLabel && !isLegacy"
	>
		<div class="flex h-full flex-col gap-4">
			<div class="flex items-start gap-2">
				<button
					v-if="draggable"
					type="button"
					draggable="true"
					class="text-dimmed hover:text-default -ml-1 cursor-grab pt-0.5"
					:aria-label="$t('saas.catalog.plans.card.drag')"
					:title="$t('saas.catalog.plans.card.drag')"
					@dragstart="emit('dragStart')"
				>
					<UIcon name="i-ph-dots-six-vertical" class="size-4" />
				</button>
				<div class="min-w-0 flex-1">
					<div class="flex items-center gap-2">
						<h3 class="text-highlighted truncate text-base font-semibold">
							{{ plan.name }}
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

			<ul v-if="features.length" class="flex flex-col gap-1.5 text-sm">
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
					@click="emit('edit')"
				>
					{{ $t('saas.catalog.plans.action.edit') }}
				</UButton>
				<UButton
					v-if="isLegacy && retireAction"
					size="sm"
					color="warning"
					variant="outline"
					icon="i-ph-archive"
					@click="emit('action', retireAction)"
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
