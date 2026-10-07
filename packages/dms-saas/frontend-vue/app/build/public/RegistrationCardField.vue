<script setup lang="ts">
/**
 * The card step of Register and "Set up your first workspace": the Stripe
 * element, why a card is asked for, and "Add a card later" when the
 * deployment allows it.
 */
import { computed } from 'vue'

interface RegistrationCardFieldProps {
	elementId: string
	policy: RegistrationPaymentMethodPolicy
	/** Whether the element is shown; it stays mounted while hidden. */
	isVisible: boolean
	/** Name of the plan the workspace opens on. */
	planName: string | null
	maxFreeWorkspacesPerCard: number | null
	error?: string | null
}

const props = withDefaults(defineProps<RegistrationCardFieldProps>(), {
	error: null,
})
const skipsPaymentMethod = defineModel<boolean>('skips', { required: true })

const { t } = useI18n()

const badge = computed(() =>
	props.policy === 'optional'
		? t('saas.public.card.optional', {
				plan: props.planName ?? t('saas.public.card.free_plan'),
			})
		: t('saas.public.card.required'),
)

const reason = computed(() =>
	t('saas.public.card.reason', {
		count: String(props.maxFreeWorkspacesPerCard ?? 1),
	}),
)
</script>

<template>
	<div v-if="policy !== 'none'" class="flex flex-col gap-2">
		<div class="flex items-center justify-between gap-2">
			<span class="text-highlighted text-sm font-medium">
				{{ $t('saas.public.card.label') }}
			</span>
			<DmsStatusPill :label="badge" tone="neutral" size="sm" dot="none" />
		</div>

		<!-- v-show keeps the Stripe element mounted while the step is hidden. -->
		<UFormField
			v-show="isVisible"
			name="card"
			:error="error ?? undefined"
			:help="reason"
		>
			<div
				:id="elementId"
				class="border-default bg-default rounded-md border p-3"
			/>
		</UFormField>

		<UCheckbox
			v-if="policy === 'optional'"
			v-model="skipsPaymentMethod"
			:label="$t('saas.public.card.later')"
			:description="$t('saas.public.card.later_hint')"
		/>
	</div>
</template>
