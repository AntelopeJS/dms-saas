<script setup lang="ts">
import { computed } from 'vue'
import {
	liveValue,
	useLiveFormValues,
} from '../build/composables/useLiveFormValues'

type RefundMode = 'full' | 'prorated'

/** The refund setting the example follows, as the page loaded it. */
interface RefundExampleInput {
	moneyBackGuaranteeMode: RefundMode
}

const props = defineProps<{
	modelValue?: RefundExampleInput | null
	componentId?: string
}>()

const TEXT = 'saas.operator_billing.billing_rules.refunds.worked_example'
// A monthly plan refunded on day 10 of 30: what each mode gives back.
const EXAMPLE_PRICE = 2900
const EXAMPLE_CURRENCY = 'eur'
const EXAMPLE_PERIOD_DAYS = 30
const EXAMPLE_REQUEST_DAY = 10

const { formatMinorUnits } = useMoneyFormat()
const live = useLiveFormValues(() => props.componentId)

const mode = computed<RefundMode>(() =>
	liveValue(
		live.value,
		'moneyBackGuaranteeMode',
		props.modelValue?.moneyBackGuaranteeMode ?? 'full',
	),
)

const unusedDays = EXAMPLE_PERIOD_DAYS - EXAMPLE_REQUEST_DAY
const proratedAmount = Math.round(
	(EXAMPLE_PRICE * unusedDays) / EXAMPLE_PERIOD_DAYS,
)

const rows = computed(() => [
	{
		mode: 'full' as const,
		amount: formatMinorUnits(EXAMPLE_PRICE, EXAMPLE_CURRENCY),
	},
	{
		mode: 'prorated' as const,
		amount: formatMinorUnits(proratedAmount, EXAMPLE_CURRENCY),
	},
])
</script>

<template>
	<div class="border-default rounded-lg border p-3 text-sm">
		<p class="text-muted mb-2">
			{{
				$t(`${TEXT}.scenario`, {
					price: formatMinorUnits(EXAMPLE_PRICE, EXAMPLE_CURRENCY),
					day: EXAMPLE_REQUEST_DAY,
					days: EXAMPLE_PERIOD_DAYS,
				})
			}}
		</p>
		<ul class="flex flex-col gap-1">
			<li
				v-for="row in rows"
				:key="row.mode"
				class="flex items-center justify-between gap-3 rounded-md px-2 py-1"
				:class="
					row.mode === mode ? 'bg-elevated text-highlighted' : 'text-muted'
				"
			>
				<span class="flex items-center gap-2">
					<UIcon
						:name="row.mode === mode ? 'i-ph-check-circle-fill' : 'i-ph-circle'"
						class="size-4"
					/>
					{{ $t(`${TEXT}.${row.mode}`, { days: unusedDays }) }}
				</span>
				<span class="font-mono tabular-nums">{{ row.amount }}</span>
			</li>
		</ul>
	</div>
</template>
