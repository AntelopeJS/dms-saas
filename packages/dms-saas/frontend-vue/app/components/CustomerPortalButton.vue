<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import type { ButtonProps } from '@nuxt/ui'

const props = withDefaults(
	defineProps<{
		/** Button text key; "Manage in Stripe" by default. */
		labelKey?: string
		color?: ButtonProps['color']
		variant?: ButtonProps['variant']
		size?: ButtonProps['size']
		icon?: string
	}>(),
	{
		labelKey: 'saas.tenant_billing.portal.open',
		color: 'neutral',
		variant: 'subtle',
		size: 'md',
		icon: 'i-ph-arrow-square-out',
	},
)

const PORTAL_ENDPOINT = '/api/saas/billing/portal-session'

interface PortalSession {
	url: string
}

const { $authFetch } = useAuthFetch()
const { resolveApiError } = useApiErrorMessage()
const { data, load } = useBillingStatus()
const isLoading = ref(false)
const failure = ref<string | null>(null)

const isAvailable = computed(
	() => !!data.value?.hasStripeCustomer && !!data.value?.isTenantOwner,
)

async function openCustomerPortal(): Promise<void> {
	isLoading.value = true
	failure.value = null
	try {
		const result = await $authFetch<PortalSession>(PORTAL_ENDPOINT, {
			method: 'POST',
			body: {
				returnUrl: typeof window !== 'undefined' ? window.location.href : '/',
			},
		})
		if (typeof window !== 'undefined') window.location.href = result.url
	} catch (error) {
		failure.value = resolveApiError(error, 'saas.tenant_billing.portal.error')
		isLoading.value = false
	}
}

onMounted(load)
</script>

<template>
	<div v-if="isAvailable" class="flex flex-col gap-2">
		<UButton
			:color="props.color"
			:variant="props.variant"
			:size="props.size"
			:icon="props.icon"
			:loading="isLoading"
			class="self-start"
			@click="openCustomerPortal"
		>
			{{ $t(props.labelKey) }}
		</UButton>
		<UAlert
			v-if="failure"
			color="error"
			variant="subtle"
			icon="i-ph-warning-circle"
			:title="failure"
			:description="$t('saas.tenant_billing.portal.error_hint')"
		>
			<template #actions>
				<UButton
					color="error"
					variant="soft"
					size="xs"
					icon="i-ph-arrow-clockwise"
					@click="openCustomerPortal"
				>
					{{ $t('saas.common.retry') }}
				</UButton>
			</template>
		</UAlert>
	</div>
</template>
