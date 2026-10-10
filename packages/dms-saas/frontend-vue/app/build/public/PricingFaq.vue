<script setup lang="ts">
import type { AccordionItem } from '@nuxt/ui'
import { computed } from 'vue'
import type { PublicBillingRules, PublicPlan, RefundMode } from './pricing'

interface PricingFaqProps {
	plans: PublicPlan[]
	rules: PublicBillingRules
}

const props = defineProps<PricingFaqProps>()

const REFUND_MODE_KEYS: Record<RefundMode, string> = {
	full: 'saas.public.pricing.faq.money_back.full',
	prorated: 'saas.public.pricing.faq.money_back.prorated',
}

const { t } = useI18n()

const hasSeatPlans = computed(() =>
	props.plans.some((plan) => plan.billingMode === 'seat' && plan.price > 0),
)

function billingAnswer(): string {
	const parts = [t('saas.public.pricing.faq.billing.renewal')]
	if (hasSeatPlans.value) parts.push(t('saas.public.pricing.faq.billing.seats'))
	parts.push(t('saas.public.pricing.faq.billing.invoices'))
	return parts.join(' ')
}

function moneyBackItem(): AccordionItem[] {
	const guarantee = props.rules.moneyBackGuarantee
	if (!guarantee) return []
	const days = String(guarantee.windowDays)
	return [
		{
			label: t('saas.public.pricing.faq.money_back.question'),
			content: [
				t('saas.public.pricing.faq.money_back.window', { days }),
				t(REFUND_MODE_KEYS[guarantee.mode]),
			].join(' '),
		},
	]
}

const items = computed<AccordionItem[]>(() => [
	{
		label: t('saas.public.pricing.faq.billing.question'),
		content: billingAnswer(),
	},
	{
		label: t('saas.public.pricing.faq.vat.question'),
		content: t('saas.public.pricing.faq.vat.answer'),
	},
	{
		label: t('saas.public.pricing.faq.cancel.question'),
		content: t('saas.public.pricing.faq.cancel.answer', {
			days: String(props.rules.dataRetentionDays),
		}),
	},
	...moneyBackItem(),
])
</script>

<template>
	<section aria-labelledby="pricing-faq-title" class="flex flex-col gap-3">
		<header>
			<h2 id="pricing-faq-title" class="text-highlighted text-lg font-semibold">
				{{ $t('saas.public.pricing.faq.title') }}
			</h2>
		</header>
		<DmsCard :padded="false" class="px-4">
			<UAccordion :items="items" type="multiple" />
		</DmsCard>
	</section>
</template>
