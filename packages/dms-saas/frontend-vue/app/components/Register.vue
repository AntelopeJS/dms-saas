<script setup lang="ts">
/**
 * Reference implementation of the public registration flow.
 *
 * Replace it by turning the bundled page off (`publicScreens.register: false`
 * in the dms-saas config) and registering your own page on the `register`
 * slug, then build the markup you want on `useSaasRegistration()`, which owns
 * the card policy, the Stripe orchestration, the validation order and the
 * provisioning call.
 */
import { computed, ref } from 'vue'
import LegalAcceptance from '../build/public/LegalAcceptance.vue'
import PublicStage from '../build/public/PublicStage.vue'
import RegistrationCardField from '../build/public/RegistrationCardField.vue'
import RegistrationPlanCard from '../build/public/RegistrationPlanCard.vue'
import {
	isPublicScreenServed,
	LOGIN_PATH,
	PRICING_PATH,
} from '../build/public/routes'

const EMAIL_IN_USE_KEY = 'saas.errors.user.email_in_use'

const { t, te } = useI18n()
const config = useDmsRuntimeConfig()
const saasConfig = config.public.dmsSaas as
	| DmsSaasPublicRuntimeConfig
	| undefined

const {
	form,
	paymentElementId,
	paymentMethodPolicy,
	isPaymentStepVisible,
	isRegistrationClosed,
	errorMessage,
	fieldErrors,
	fieldErrorCount,
	clearServerError,
	isSubmitting,
	submit,
	planSummary,
	isPlanLoading,
	planLoadError,
	reloadPlan,
} = useSaasRegistration()

const isPasswordShown = ref(false)
const changePlanTo = isPublicScreenServed(saasConfig, 'pricing')
	? PRICING_PATH
	: null

const isEmailTaken = computed(
	() => fieldErrors.value.email === EMAIL_IN_USE_KEY,
)

const subtitle = computed(() => {
	const plan = planSummary.value?.plan
	return plan
		? t('saas.public.register.subtitle_plan', { plan: plan.name })
		: t('saas.public.register.subtitle')
})

/** A field error is a translation key, or Stripe's own words for the card. */
function errorText(message: string | undefined): string | undefined {
	if (!message) return undefined
	return te(message) ? t(message) : message
}
</script>

<template>
	<DmsSaasRegistrationClosed v-if="isRegistrationClosed" />
	<PublicStage
		v-else
		width="wide"
		:title="$t('saas.public.register.title')"
		:description="subtitle"
	>
		<template #eyebrow>
			<RegistrationPlanCard
				class="mb-5"
				:summary="planSummary"
				:is-loading="isPlanLoading"
				:load-error="planLoadError"
				:change-to="changePlanTo"
				@retry="reloadPlan"
			/>
		</template>

		<DmsOAuthButtons :note="$t('saas.public.register.oauth_note')" />

		<form class="mt-5 flex flex-col gap-4" novalidate @submit.prevent="submit">
			<DmsBanner
				v-if="fieldErrorCount > 0"
				tone="error"
				icon="i-ph-warning-circle"
				:title="$t('saas.public.register.summary.title')"
				:description="
					$t(
						'saas.public.register.summary.description',
						{ count: fieldErrorCount },
						fieldErrorCount,
					)
				"
				role="alert"
			/>
			<DmsBanner
				v-else-if="errorMessage"
				tone="error"
				icon="i-ph-warning-circle"
				:title="$t('saas.public.register.summary.title')"
				:description="errorMessage"
				role="alert"
			/>

			<UFormField
				:label="$t('saas.public.register.field.full_name')"
				name="name"
				:error="errorText(fieldErrors.name)"
			>
				<UInput
					v-model="form.name"
					autocomplete="name"
					size="lg"
					class="w-full"
				/>
			</UFormField>

			<UFormField
				:label="$t('saas.public.register.field.email')"
				name="email"
				:error="errorText(fieldErrors.email)"
			>
				<UInput
					v-model="form.email"
					type="email"
					autocomplete="email"
					size="lg"
					class="w-full"
					@update:model-value="clearServerError('email')"
				/>
				<template v-if="isEmailTaken" #help>
					<i18n-t
						keypath="saas.public.register.email_taken_hint"
						tag="span"
						scope="global"
					>
						<template #sign_in>
							<DmsLink :to="LOGIN_PATH" class="text-primary underline">
								{{ $t('saas.public.register.sign_in_instead') }}
							</DmsLink>
						</template>
					</i18n-t>
				</template>
			</UFormField>

			<UFormField
				:label="$t('saas.public.register.field.password')"
				name="password"
				:error="errorText(fieldErrors.password)"
			>
				<UInput
					v-model="form.password"
					:type="isPasswordShown ? 'text' : 'password'"
					autocomplete="new-password"
					size="lg"
					class="w-full"
					aria-describedby="register-password-rules"
					:ui="{ trailing: 'pe-1' }"
				>
					<template #trailing>
						<UButton
							color="neutral"
							variant="link"
							size="sm"
							:icon="isPasswordShown ? 'i-ph-eye-slash' : 'i-ph-eye'"
							:aria-label="
								isPasswordShown
									? $t('saas.public.register.hide_password')
									: $t('saas.public.register.show_password')
							"
							:aria-pressed="isPasswordShown"
							@click="isPasswordShown = !isPasswordShown"
						/>
					</template>
				</UInput>
			</UFormField>
			<DmsPasswordRules
				:password="form.password"
				list-id="register-password-rules"
			/>

			<RegistrationCardField
				v-model:skips="form.skipsPaymentMethod"
				:element-id="paymentElementId"
				:policy="paymentMethodPolicy"
				:is-visible="isPaymentStepVisible"
				:plan-name="planSummary?.plan.name ?? null"
				:max-free-workspaces-per-card="
					planSummary?.rules.maxFreeWorkspacesPerCard ?? null
				"
				:error="errorText(fieldErrors.card)"
			/>

			<LegalAcceptance
				v-model="form.hasAcceptedLegal"
				:error="errorText(fieldErrors.legal)"
			/>

			<UButton
				type="submit"
				:loading="isSubmitting"
				:label="$t('saas.public.register.submit')"
				size="lg"
				class="justify-center"
				block
			/>
		</form>

		<p class="text-muted mt-5 text-center text-[13px]">
			{{ $t('saas.public.register.has_account') }}
			<DmsLink :to="LOGIN_PATH" class="text-primary font-medium">
				{{ $t('saas.public.register.sign_in') }}
			</DmsLink>
		</p>
	</PublicStage>
</template>
