<script setup lang="ts">
/**
 * The public pricing page: the plans on sale, a full comparison and the
 * billing answers a visitor needs before signing up. Every plan leads to
 * Register with the plan chosen.
 */
import { computed, onMounted, ref, watch } from 'vue'
import PricingComparison from '../build/public/PricingComparison.vue'
import PricingFaq from '../build/public/PricingFaq.vue'
import {
	findParentPlan,
	paidIntervals,
	planReference,
	plansForInterval,
	type PublicPricing,
	sharedCurrency,
} from '../build/public/pricing'
import {
	isPublicScreenServed,
	LOGIN_PATH,
	REGISTER_PATH,
	registerPathFor,
} from '../build/public/routes'
import { usePublicFetch } from '../build/public/usePublicFetch'
import type { PlanInterval } from '../composables/usePlanIntervalLabel'

const PRICING_ENDPOINT = '/api/saas/pricing'
const SKELETON_CARDS = 3
const INVITATION_ONLY = 'invitation-only'

const { t } = useI18n()
const publicFetch = usePublicFetch()
const { resolveApiError } = useApiErrorMessage()
const config = useDmsRuntimeConfig()
const saasConfig = config.public.dmsSaas as
	| DmsSaasPublicRuntimeConfig
	| undefined

const pricing = ref<PublicPricing | null>(null)
const isLoading = ref(true)
const loadError = ref<string | null>(null)
const interval = ref<PlanInterval>('month')

const canRegister =
	saasConfig?.admissionMode !== INVITATION_ONLY &&
	isPublicScreenServed(saasConfig, 'register')

const intervals = computed(() => paidIntervals(pricing.value?.plans ?? []))
const intervalItems = computed(() =>
	intervals.value.map((value) => ({
		value,
		label: t(`saas.public.pricing.interval.${value}`),
	})),
)
const shownPlans = computed(() =>
	plansForInterval(pricing.value?.plans ?? [], interval.value),
)
const currency = computed(() => sharedCurrency(shownPlans.value))
const freePlan = computed(
	() => shownPlans.value.find((plan) => plan.price <= 0) ?? null,
)

const reassurances = computed(() => {
	const guarantee = pricing.value?.rules.moneyBackGuarantee
	return [
		{
			icon: 'i-ph-receipt',
			label: currency.value
				? t('saas.public.pricing.reassurance.currency', {
						currency: currency.value,
					})
				: t('saas.public.pricing.reassurance.vat'),
		},
		...(guarantee
			? [
					{
						icon: 'i-ph-arrow-counter-clockwise',
						label: t('saas.public.pricing.reassurance.money_back', {
							days: String(guarantee.windowDays),
						}),
					},
				]
			: []),
		{ icon: 'i-ph-swap', label: t('saas.public.pricing.reassurance.cancel') },
		{
			icon: 'i-ph-lock-key',
			label: t('saas.public.pricing.reassurance.stripe'),
		},
	]
})

function selectInterval(value: string | number | undefined): void {
	const chosen = intervals.value.find((entry) => entry === value)
	if (chosen) interval.value = chosen
}

watch(intervals, (available) => {
	if (available.length && !available.includes(interval.value)) {
		interval.value = available[0]!
	}
})

async function loadPricing(): Promise<void> {
	isLoading.value = true
	loadError.value = null
	try {
		pricing.value = await publicFetch<PublicPricing>(PRICING_ENDPOINT)
	} catch (error) {
		loadError.value = resolveApiError(error, 'saas.public.pricing.load_error')
	} finally {
		isLoading.value = false
	}
}

onMounted(loadPricing)
</script>

<template>
	<div class="mx-auto flex w-full max-w-6xl flex-col gap-10 py-4">
		<nav
			class="flex justify-end gap-2"
			:aria-label="$t('saas.public.pricing.nav')"
		>
			<UButton
				:to="LOGIN_PATH"
				:label="$t('saas.public.pricing.sign_in')"
				color="neutral"
				variant="ghost"
				size="sm"
			/>
			<UButton
				v-if="canRegister"
				:to="REGISTER_PATH"
				:label="$t('saas.public.pricing.create_account')"
				size="sm"
			/>
		</nav>

		<header
			class="mx-auto flex max-w-2xl flex-col items-center gap-3 text-center"
		>
			<DmsEyebrow
				as="span"
				tone="primary"
				:label="$t('saas.public.pricing.eyebrow')"
			/>
			<h1 class="text-highlighted text-3xl font-[650] tracking-[-0.025em]">
				{{ $t('saas.public.pricing.title') }}
			</h1>
			<p class="text-muted">{{ $t('saas.public.pricing.subtitle') }}</p>
			<DmsSegmented
				v-if="intervalItems.length > 1"
				:model-value="interval"
				:items="intervalItems"
				@update:model-value="selectInterval"
				:aria-label="$t('saas.public.pricing.interval.label')"
				size="md"
				class="mt-2"
			/>
		</header>

		<div v-if="isLoading" class="grid gap-4 md:grid-cols-3" aria-busy="true">
			<USkeleton
				v-for="index in SKELETON_CARDS"
				:key="index"
				class="h-96 rounded-xl"
			/>
		</div>

		<DmsCard v-else-if="loadError">
			<DmsEmptyState
				variant="error"
				:title="$t('saas.public.pricing.load_error')"
				:description="loadError"
				:actions="[
					{
						label: $t('saas.public.common.retry'),
						icon: 'i-ph-arrows-clockwise',
						onClick: loadPricing,
					},
				]"
			/>
		</DmsCard>

		<DmsCard v-else-if="!shownPlans.length">
			<DmsEmptyState
				:title="$t('saas.public.pricing.empty_title')"
				:description="$t('saas.public.pricing.empty_description')"
				icon="i-ph-tag"
				:actions="[
					{ label: $t('saas.public.pricing.sign_in'), to: LOGIN_PATH },
				]"
			/>
		</DmsCard>

		<template v-else-if="pricing">
			<!-- Wrapped and centred: a catalogue of five does not leave one card
			alone on the left of a second row. -->
			<div class="flex flex-wrap items-stretch justify-center gap-4">
				<DmsSaasPlanCardPublic
					class="min-w-[15rem] max-w-sm flex-[1_1_15rem]"
					v-for="plan in shownPlans"
					:key="plan._id"
					:plan="plan"
					:features="pricing.features"
					:parent="findParentPlan(plan, shownPlans)"
					:to="registerPathFor(planReference(plan))"
				/>
			</div>

			<ul
				class="text-muted flex flex-wrap justify-center gap-x-6 gap-y-2 text-[13px]"
			>
				<li
					v-for="item in reassurances"
					:key="item.label"
					class="flex items-center gap-1.5"
				>
					<UIcon :name="item.icon" class="text-primary size-4" />
					{{ item.label }}
				</li>
			</ul>

			<PricingComparison
				:plans="shownPlans"
				:features="pricing.features"
				:rules="pricing.rules"
			/>

			<PricingFaq :plans="shownPlans" :rules="pricing.rules" />

			<DmsCard
				v-if="freePlan && canRegister"
				class="flex flex-wrap items-center justify-between gap-4"
			>
				<div>
					<h2 class="text-highlighted font-semibold">
						{{ $t('saas.public.pricing.closing.title') }}
					</h2>
					<p class="text-muted text-[13px]">
						{{
							$t('saas.public.pricing.closing.description', {
								plan: freePlan.name,
							})
						}}
					</p>
				</div>
				<UButton
					:to="registerPathFor(planReference(freePlan))"
					:label="$t('saas.public.pricing.card.cta_free')"
				/>
			</DmsCard>
		</template>
	</div>
</template>
