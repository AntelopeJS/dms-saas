<script setup lang="ts">
import { computed } from 'vue'
import { useLiveFormSnapshot } from '../build/composables/useLiveFormValues'
import {
	cardFeatures,
	cardPriceSuffixKey,
	formatPlanAmount,
	isPlanFeatureValue,
	type PlanCatalog,
	type PlanFeatureValue,
	PLANS_ENDPOINT,
	PLAN_UNLIMITED,
} from '../build/plan-catalog'
import { fromMinorUnits } from '../composables/useMoneyFormat'

interface PlanAccess {
	parentPlanId: string | null
	extraFeatures: Record<string, PlanFeatureValue>
}

/** A plan text as the editor holds it: one value per locale. */
type PlanText = Record<string, string>

/** The plan fields the preview reads, saved or as typed. */
interface PlanDraft {
	name?: PlanText | null
	description?: PlanText | null
	price?: number | string
	currency?: string
	interval?: 'month' | 'year'
	billingMode?: 'flat' | 'seat'
	trialDays?: number | string
	maxMembers?: number | string
	borderLabel?: PlanText | null
	borderColor?: string | null
	inheritance?: PlanAccess | null
}

type SyncState = 'synced' | 'out_of_sync' | 'off_stripe' | 'not_configured'

interface EditorContext {
	workspaceCount: number
	trialingCount: number
	stripeProductId: string | null
	stripeProductUrl: string | null
	stripePriceId: string | null
	syncedPrice: number | null
	syncedCurrency: string | null
	syncedInterval: string | null
	syncState: SyncState
}

const FEATURE_PREVIEW_LIMIT = 6
/** Locale the server reads a plan text in when the reader's has none. */
const PLAN_FALLBACK_LOCALE = 'en'

const SYNC_TONES: Record<SyncState, 'success' | 'warning' | 'neutral'> = {
	synced: 'success',
	out_of_sync: 'warning',
	off_stripe: 'neutral',
	not_configured: 'warning',
}

const props = defineProps<{
	componentId?: string
	routeParams?: Record<string, string>
	formKey?: string
}>()

const EMPTY_CATALOG: PlanCatalog = {
	plans: [],
	features: [],
	newPlanPermissions: [],
}

function isObject(value: unknown): value is object {
	return typeof value === 'object' && value !== null
}

function isText(value: unknown): value is string {
	return typeof value === 'string'
}

function isAmount(value: unknown): value is number | string {
	return typeof value === 'number' || typeof value === 'string'
}

function isPlanText(value: unknown): value is PlanText {
	return isObject(value) && Object.values(value).every(isText)
}

function isPlanAccess(value: unknown): value is PlanAccess {
	return (
		isObject(value) &&
		'parentPlanId' in value &&
		(value.parentPlanId === null || isText(value.parentPlanId)) &&
		'extraFeatures' in value &&
		isObject(value.extraFeatures) &&
		Object.values(value.extraFeatures).every(isPlanFeatureValue)
	)
}

function isInterval(
	value: unknown,
): value is NonNullable<PlanDraft['interval']> {
	return value === 'month' || value === 'year'
}

function isBillingMode(
	value: unknown,
): value is NonNullable<PlanDraft['billingMode']> {
	return value === 'flat' || value === 'seat'
}

/** The plan fields the form reports, those of a kind the preview can read. */
function parsePlanDraft(fields: ReadonlyMap<string, unknown>): PlanDraft {
	const name = fields.get('name')
	const description = fields.get('description')
	const price = fields.get('price')
	const currency = fields.get('currency')
	const interval = fields.get('interval')
	const billingMode = fields.get('billingMode')
	const trialDays = fields.get('trialDays')
	const maxMembers = fields.get('maxMembers')
	const borderLabel = fields.get('borderLabel')
	const borderColor = fields.get('borderColor')
	const inheritance = fields.get('inheritance')
	return {
		...(isPlanText(name) && { name }),
		...(isPlanText(description) && { description }),
		...(isAmount(price) && { price }),
		...(isText(currency) && { currency }),
		...(isInterval(interval) && { interval }),
		...(isBillingMode(billingMode) && { billingMode }),
		...(isAmount(trialDays) && { trialDays }),
		...(isAmount(maxMembers) && { maxMembers }),
		...(isPlanText(borderLabel) && { borderLabel }),
		...(isText(borderColor) && { borderColor }),
		...(isPlanAccess(inheritance) && { inheritance }),
	}
}

const { t, locale } = useI18n()
const { formatFeatureValue } = usePlanFeatureFormat()

const planId = computed(() => props.routeParams?.id)
/** A new plan has nothing saved and no Stripe context yet. */
const savedPlan = useApiData<PlanDraft>(() =>
	planId.value ? `${PLANS_ENDPOINT}/${planId.value}` : null,
)
const editorContext = useApiData<EditorContext>(() =>
	planId.value ? `${PLANS_ENDPOINT}/${planId.value}/editor-context` : null,
)
const saved = savedPlan.data
const context = editorContext.data
/** The form declared beside the preview, in the same grid row. */
const formComponentId = computed(() =>
	props.componentId
		? siblingComponentId(props.componentId, props.formKey ?? 'form')
		: undefined,
)
const live = useLiveFormSnapshot(
	() => formComponentId.value,
	(formValues) => parsePlanDraft(new Map(Object.entries(formValues))),
)
const planCatalog = usePlanCatalog()
const catalog = computed(() => planCatalog.data.value ?? EMPTY_CATALOG)
const reads = [planCatalog, savedPlan, editorContext]
const hasError = computed(() =>
	reads.some((read) => read.status.value === 'error'),
)
const isLoading = computed(
	() =>
		!hasError.value &&
		(!planCatalog.data.value || reads.some((read) => read.pending.value)),
)
const draft = computed<PlanDraft>(() => live.value ?? saved.value ?? {})

function textIn(value: PlanText | null | undefined, key: string): string {
	return value && Object.hasOwn(value, key) ? (value[key] ?? '') : ''
}

/** A plan text as the cards show it: the reader's locale, else the fallback one. */
function textOf(value: PlanText | null | undefined): string {
	return textIn(value, locale.value) || textIn(value, PLAN_FALLBACK_LOCALE)
}

const name = computed(() => textOf(draft.value.name))
const description = computed(() => textOf(draft.value.description))
const badge = computed(() => textOf(draft.value.borderLabel))
const currency = computed(() => draft.value.currency ?? 'EUR')
const price = computed(() => Number(draft.value.price ?? 0))
const interval = computed(() => draft.value.interval ?? 'month')
const trialDays = computed(() => Number(draft.value.trialDays ?? 0))

function money(amount: number, code = currency.value): string {
	return formatPlanAmount(amount, code, locale.value)
}

const priceSuffix = computed(() =>
	t(
		cardPriceSuffixKey({
			price: price.value,
			interval: interval.value,
			billingMode: draft.value.billingMode ?? 'flat',
		}),
	),
)

const terms = computed(() => {
	const parts = [t('saas.catalog.editor.preview.excl_vat')]
	if (trialDays.value > 0) {
		parts.push(
			t('saas.catalog.editor.preview.trial', { days: trialDays.value }),
		)
	}
	return parts.join(' · ')
})

const cta = computed(() =>
	trialDays.value > 0
		? t('saas.catalog.editor.preview.start_trial')
		: t('saas.catalog.editor.preview.choose', { name: name.value }),
)

const resolvedFeatures = computed(() => {
	const access = draft.value.inheritance
	const parent = catalog.value.plans.find(
		(plan) => plan._id === access?.parentPlanId,
	)
	const values = new Map(
		(parent?.features ?? []).map((entry) => [entry.featureId, entry.value]),
	)
	for (const [featureId, value] of Object.entries(
		access?.extraFeatures ?? {},
	)) {
		values.set(featureId, value)
	}
	return [...values].map(([featureId, value]) => ({ featureId, value }))
})

const features = computed(() =>
	cardFeatures(
		catalog.value.features,
		resolvedFeatures.value,
		FEATURE_PREVIEW_LIMIT,
	),
)

const membersLine = computed(() => {
	const cap = Number(draft.value.maxMembers ?? PLAN_UNLIMITED)
	return cap === PLAN_UNLIMITED
		? t('saas.catalog.plans.card.members_unlimited')
		: t('saas.catalog.plans.card.members', { count: cap }, cap)
})

function featureLine(entry: (typeof features.value)[number]): string {
	if (entry.feature.valueType === 'boolean' || !entry.isIncluded)
		return entry.feature.displayName
	const value = formatFeatureValue(
		{ ...entry.feature, featureId: entry.feature._id },
		entry.value,
		currency.value,
	)
	return `${entry.feature.displayName} · ${value}`
}

const syncedAmount = computed(() =>
	context.value?.syncedPrice != null
		? fromMinorUnits(
				context.value.syncedPrice,
				context.value.syncedCurrency ?? currency.value,
			)
		: null,
)

/** A save that moves the price creates a new Stripe price. */
const isPriceChanged = computed(() => {
	if (!saved.value || !context.value?.stripePriceId) return false
	const before = saved.value
	return (
		Number(before.price) !== price.value ||
		before.currency !== currency.value ||
		before.interval !== interval.value ||
		before.billingMode !== draft.value.billingMode
	)
})

const productUrl = computed(() => context.value?.stripeProductUrl ?? undefined)

async function load(): Promise<void> {
	await Promise.all(reads.map((read) => read.refresh()))
}
</script>

<template>
	<div class="flex flex-col gap-4 lg:sticky lg:top-4">
		<DmsCardPanel>
			<template #header>
				<div class="flex w-full items-center justify-between gap-2">
					<span class="text-highlighted text-sm font-semibold">
						{{ $t('saas.catalog.editor.preview.title') }}
					</span>
					<span class="text-muted text-xs">
						{{ $t(`saas.catalog.editor.preview.context_${interval}`) }}
					</span>
				</div>
			</template>
			<div v-if="isLoading" class="flex flex-col gap-2">
				<USkeleton class="h-6 w-1/2" />
				<USkeleton class="h-10 w-2/3" />
				<USkeleton class="h-24 w-full" />
			</div>
			<DmsSaasLoadFailure
				v-else-if="hasError"
				:title="$t('saas.catalog.editor.preview.failed')"
				@retry="load"
			/>
			<div
				v-else
				class="border-default relative flex flex-col gap-3 rounded-xl border p-4"
				:style="
					badge ? { borderColor: draft.borderColor || undefined } : undefined
				"
			>
				<UBadge
					v-if="badge"
					class="absolute -top-2.5 left-4"
					size="sm"
					icon="i-ph-star"
					:style="
						draft.borderColor
							? { backgroundColor: draft.borderColor }
							: undefined
					"
				>
					{{ badge }}
				</UBadge>
				<div>
					<p class="text-highlighted text-lg font-semibold">
						{{ name || $t('saas.catalog.editor.preview.unnamed') }}
					</p>
					<p v-if="description" class="text-muted line-clamp-2 text-sm">
						{{ description }}
					</p>
				</div>
				<div>
					<span class="text-highlighted text-3xl font-bold tabular-nums">
						{{ money(price) }}
					</span>
					<span class="text-muted ml-1 text-sm">{{ priceSuffix }}</span>
					<p class="text-dimmed text-xs">{{ terms }}</p>
				</div>
				<UButton block :ui="{ base: 'pointer-events-none' }" tabindex="-1">
					{{ cta }}
				</UButton>
				<ul class="flex flex-col gap-1.5 text-sm">
					<li class="flex items-center gap-2">
						<UIcon name="i-ph-users" class="text-muted size-4" />
						{{ membersLine }}
					</li>
					<li
						v-for="entry in features"
						:key="entry.feature._id"
						class="flex items-center gap-2"
						:class="{ 'text-dimmed line-through': !entry.isIncluded }"
					>
						<UIcon
							:name="entry.isIncluded ? 'i-ph-check' : 'i-ph-x'"
							class="size-4"
							:class="{ 'text-success': entry.isIncluded }"
						/>
						{{ featureLine(entry) }}
					</li>
				</ul>
			</div>
		</DmsCardPanel>

		<DmsCardPanel v-if="context">
			<template #header>
				<div class="flex items-center justify-between">
					<span class="text-highlighted text-sm font-semibold">
						{{ $t('saas.catalog.editor.stripe.title') }}
					</span>
					<DmsStatusPill
						size="sm"
						:tone="SYNC_TONES[context.syncState]"
						:label="$t(`saas.catalog.editor.stripe.state.${context.syncState}`)"
					/>
				</div>
			</template>
			<dl class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
				<dt class="text-muted">
					{{ $t('saas.catalog.editor.stripe.product') }}
				</dt>
				<dd class="truncate font-mono text-xs">
					<ULink
						v-if="productUrl"
						:to="productUrl"
						target="_blank"
						class="text-primary"
					>
						{{ context.stripeProductId }}
					</ULink>
					<span v-else class="text-dimmed">—</span>
				</dd>
				<dt class="text-muted">{{ $t('saas.catalog.editor.stripe.price') }}</dt>
				<dd class="text-xs">
					<template v-if="syncedAmount !== null && context.syncedCurrency">
						{{ money(syncedAmount, context.syncedCurrency) }}
						<span class="text-dimmed">
							·
							{{
								$t(
									`saas.catalog.plans.interval.${context.syncedInterval ?? 'month'}`,
								)
							}}
						</span>
						<span class="text-dimmed block font-mono">
							{{ context.stripePriceId }}
						</span>
					</template>
					<span v-else class="text-dimmed">—</span>
				</dd>
			</dl>
			<UAlert
				v-if="isPriceChanged"
				class="mt-3"
				color="info"
				variant="subtle"
				icon="i-ph-info"
				:title="$t('saas.catalog.editor.stripe.on_save_title')"
				:description="
					$t(
						'saas.catalog.editor.stripe.on_save',
						{
							price: money(price),
							interval: $t(`saas.catalog.plans.interval.${interval}`),
							previous:
								syncedAmount !== null
									? money(syncedAmount, context.syncedCurrency ?? currency)
									: '—',
							count: context.workspaceCount,
						},
						context.workspaceCount,
					)
				"
			/>
		</DmsCardPanel>
	</div>
</template>
