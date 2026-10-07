<script setup lang="ts">
/**
 * "Set up your first workspace": where an account that belongs to no
 * workspace lands after signing in (OAuth or password), holding a tenant
 * assignment token. It names the identity, opens the workspace on the free
 * plan with the card policy of registration, and sends a paid choice made on
 * Pricing to the upgrade review on Billing.
 */
import { computed, onMounted, ref } from 'vue'
import {
	readChosenPlan,
	rememberChosenPlan,
} from '../../build/public/chosen-plan'
import LegalAcceptance from '../../build/public/LegalAcceptance.vue'
import { isPaidPlan } from '../../build/public/pricing'
import PublicStage from '../../build/public/PublicStage.vue'
import RegistrationCardField from '../../build/public/RegistrationCardField.vue'
import RegistrationPlanCard from '../../build/public/RegistrationPlanCard.vue'
import {
	billingUpgradePath,
	HOME_PATH,
	isPublicScreenServed,
	LOGIN_PATH,
	PRICING_PATH,
} from '../../build/public/routes'
import { usePublicFetch } from '../../build/public/usePublicFetch'

interface OAuthProviderOption {
	id: string
	label: string
	icon: string
}

interface DmsPublicRuntime {
	oauthProviders?: OAuthProviderOption[]
}

interface PendingRegistration {
	email: string
	name: string
	provider: string | null
}

interface SetupIntentResponse {
	clientSecret: string | null
}

type EntryFailure = 'session' | 'already_has_workspace' | 'entry'

const SETUP_INTENT_ENDPOINT = '/api/saas/register/setup-intent'
const PENDING_ENDPOINT = '/api/saas/register/pending'
const PAYMENT_ELEMENT_ID = 'dms-saas-finalize-payment-element'
const FALLBACK_PROVIDER_ICON = 'i-ph-shield-check'
const DEFAULT_WORKSPACE_NAME_KEY = 'saas.public.register.default_workspace_name'
const ALREADY_HAS_WORKSPACE_KEY = 'saas.errors.user.already_has_workspace'
const NEW_TAB = '_blank'

const route = useDmsRoute()
const config = useDmsRuntimeConfig()
const { t, te } = useI18n()
const publicFetch = usePublicFetch()
const { resolveApiError } = useApiErrorMessage()
const saasConfig = config.public.dmsSaas as
	| DmsSaasPublicRuntimeConfig
	| undefined
const dmsRuntime = config.public.dms as DmsPublicRuntime
const isRegistrationClosed = isRegistrationClosedBy(saasConfig)
const paymentMethodPolicy = resolveRegistrationPaymentPolicy(saasConfig)
const comparePlansTo = isPublicScreenServed(saasConfig, 'pricing')
	? PRICING_PATH
	: null

const plan = useSaasRegistrationPlan(readChosenPlan)

const tenantAssignmentToken = computed(() => {
	const value = route.query.token
	return typeof value === 'string' ? value : ''
})

const pending = ref<PendingRegistration | null>(null)
const entryFailure = ref<EntryFailure | null>(
	tenantAssignmentToken.value ? null : 'session',
)
const entryErrorMessage = ref<string | null>(null)
const isEntryLoading = ref(!entryFailure.value)
const workspaceName = ref('')
const hasAcceptedLegal = ref(false)
const skipsPaymentMethod = ref(false)
const hasTriedSubmit = ref(false)
const isSubmitting = ref(false)
const errorMessage = ref<string | null>(null)
const cardError = ref<string | null>(null)
const stripeHandle = ref<ReturnType<typeof useStripePaymentElement> | null>(
	null,
)

const isPaymentStepVisible = computed(() =>
	isPaymentStepShown(paymentMethodPolicy, skipsPaymentMethod.value),
)

const entryProvider = computed<OAuthProviderOption | null>(() => {
	const providerId = pending.value?.provider
	if (!providerId) return null
	const declared = dmsRuntime.oauthProviders ?? []
	return (
		declared.find((provider) => provider.id === providerId) ?? {
			id: providerId,
			label: providerId,
			icon: FALLBACK_PROVIDER_ICON,
		}
	)
})

const identityTitle = computed(() => {
	const email = pending.value?.email ?? ''
	const provider = entryProvider.value
	return provider
		? t('saas.public.no_workspace.identity.provider', {
				email,
				provider: provider.label,
			})
		: t('saas.public.no_workspace.identity.password', { email })
})

const missingRequirement = computed(() =>
	firstMissingRegistrationRequirement({
		isPaymentRequired: isPaymentStepVisible.value,
		isPaymentReady: stripeHandle.value !== null,
		hasAcceptedLegal: hasAcceptedLegal.value,
	}),
)

const nameError = computed(() =>
	hasTriedSubmit.value && !workspaceName.value.trim()
		? t('saas.public.no_workspace.error.name_required')
		: undefined,
)
const legalError = computed(() =>
	hasTriedSubmit.value && !hasAcceptedLegal.value
		? t('saas.public.register.error.legal_required')
		: null,
)

function toLogin(): void {
	if (typeof window !== 'undefined') window.location.href = LOGIN_PATH
}

function landingPath(): string {
	const requested = plan.summary.value?.requestedPlan
	return requested && isPaidPlan(requested)
		? billingUpgradePath(requested._id)
		: HOME_PATH
}

function classifyEntryFailure(error: unknown): EntryFailure {
	return readApiErrorKey(error) === ALREADY_HAS_WORKSPACE_KEY
		? 'already_has_workspace'
		: 'entry'
}

async function loadPendingRegistration(): Promise<void> {
	try {
		pending.value = await publicFetch<PendingRegistration>(PENDING_ENDPOINT, {
			method: 'POST',
			body: { tenant_assignment_token: tenantAssignmentToken.value },
		})
		workspaceName.value = t(DEFAULT_WORKSPACE_NAME_KEY, {
			name: pending.value.name,
		})
	} catch (error) {
		entryFailure.value = classifyEntryFailure(error)
		entryErrorMessage.value = resolveApiError(
			error,
			'saas.public.no_workspace.entry_failed.title',
		)
	} finally {
		isEntryLoading.value = false
	}
}

async function mountPaymentElement(): Promise<void> {
	const publishableKey = saasConfig?.stripePublishableKey
	if (!publishableKey || paymentMethodPolicy === 'none') return
	try {
		const setup = await publicFetch<SetupIntentResponse>(SETUP_INTENT_ENDPOINT)
		if (!setup.clientSecret) return
		stripeHandle.value = useStripePaymentElement({
			publishableKey,
			clientSecret: setup.clientSecret,
			containerId: PAYMENT_ELEMENT_ID,
			billingEmail: () => pending.value?.email ?? '',
		})
	} catch (error) {
		cardError.value = resolveApiError(error, 'saas.public.register.error.load')
	}
}

/** The confirmed card, undefined when none is collected, null on failure. */
async function confirmPaymentMethod(): Promise<string | undefined | null> {
	if (!isPaymentStepVisible.value) return undefined
	const confirmation = await stripeHandle.value?.confirmAndGetPaymentMethod()
	if (confirmation?.paymentMethodId) return confirmation.paymentMethodId
	cardError.value =
		confirmation?.error?.message ??
		t('saas.public.register.error.card_required')
	return null
}

function validate(): boolean {
	hasTriedSubmit.value = true
	errorMessage.value = null
	cardError.value = null
	if (missingRequirement.value === 'saas.public.register.error.card_required') {
		cardError.value = t(missingRequirement.value)
	}
	return !nameError.value && !missingRequirement.value
}

async function submit(): Promise<void> {
	if (isSubmitting.value || !validate()) return
	isSubmitting.value = true
	try {
		const paymentMethodId = await confirmPaymentMethod()
		if (paymentMethodId === null) return
		await $fetch(SESSION_ESTABLISH_ENDPOINT, {
			method: 'POST',
			body: buildSessionEstablishRequest({
				tenantAssignmentToken: tenantAssignmentToken.value,
				workspaceName: workspaceName.value.trim(),
				paymentMethodId,
			}),
		})
		const destination = landingPath()
		rememberChosenPlan(null)
		if (typeof window !== 'undefined') window.location.href = destination
	} catch (error) {
		errorMessage.value = resolveApiError(
			error,
			'saas.public.register.error.failed',
		)
	} finally {
		isSubmitting.value = false
	}
}

function errorText(message: string | null): string | undefined {
	if (!message) return undefined
	return te(message) ? t(message) : message
}

onMounted(async () => {
	if (entryFailure.value || isRegistrationClosed) return
	// The identity is resolved before anything is asked of the user: an expired
	// token or an account that already owns a workspace must fail here, not
	// after a card has been entered.
	await loadPendingRegistration()
	if (entryFailure.value) return
	void plan.load()
	await mountPaymentElement()
})
</script>

<template>
	<DmsSaasRegistrationClosed v-if="isRegistrationClosed" />

	<PublicStage
		v-else-if="entryFailure === 'session'"
		icon="i-ph-clock-countdown"
		tone="warning"
		:title="$t('saas.public.no_workspace.session.title')"
		:description="$t('saas.public.no_workspace.session.description')"
	>
		<UButton
			:label="$t('saas.public.no_workspace.sign_in_again')"
			size="lg"
			class="mt-5 justify-center"
			block
			@click="toLogin"
		/>
	</PublicStage>

	<PublicStage
		v-else-if="entryFailure === 'already_has_workspace'"
		icon="i-ph-buildings"
		tone="primary"
		:title="$t('saas.public.no_workspace.already.title')"
		:description="$t('saas.public.no_workspace.already.description')"
	>
		<UButton
			:to="HOME_PATH"
			external
			:label="$t('saas.public.no_workspace.already.open')"
			size="lg"
			class="mt-5 justify-center"
			block
		/>
	</PublicStage>

	<PublicStage
		v-else-if="entryFailure === 'entry'"
		icon="i-ph-warning-circle"
		tone="error"
		:title="$t('saas.public.no_workspace.entry_failed.title')"
		:description="entryErrorMessage ?? undefined"
	>
		<UButton
			:label="$t('saas.public.no_workspace.entry_failed.action')"
			size="lg"
			class="mt-5 justify-center"
			block
			@click="toLogin"
		/>
	</PublicStage>

	<PublicStage
		v-else
		width="wide"
		:eyebrow="$t('saas.public.no_workspace.eyebrow')"
		:title="$t('saas.public.no_workspace.title')"
		:description="$t('saas.public.no_workspace.subtitle')"
	>
		<div
			v-if="isEntryLoading"
			class="mt-5 flex flex-col gap-3"
			aria-busy="true"
		>
			<USkeleton class="h-14 w-full rounded-lg" />
			<USkeleton class="h-10 w-full rounded-lg" />
			<USkeleton class="h-24 w-full rounded-lg" />
		</div>

		<form
			v-else
			class="mt-5 flex flex-col gap-5"
			novalidate
			@submit.prevent="submit"
		>
			<DmsBanner
				v-if="pending"
				tone="info"
				size="sm"
				:icon="entryProvider?.icon ?? 'i-ph-user-circle'"
				:title="identityTitle"
				:description="$t('saas.public.no_workspace.identity.hint')"
			>
				<template #actions>
					<UButton
						:label="$t('saas.public.no_workspace.identity.not_you')"
						size="xs"
						color="neutral"
						variant="ghost"
						@click="toLogin"
					/>
				</template>
			</DmsBanner>

			<UFormField
				:label="$t('saas.public.no_workspace.workspace_name')"
				:help="$t('saas.public.no_workspace.workspace_name_hint')"
				name="workspaceName"
				:error="nameError"
			>
				<UInput
					v-model="workspaceName"
					size="lg"
					class="w-full"
					autocomplete="organization"
				/>
			</UFormField>

			<RegistrationPlanCard
				:summary="plan.summary.value"
				:is-loading="plan.isLoading.value"
				:load-error="plan.loadError.value"
				:change-to="comparePlansTo"
				:change-label="$t('saas.public.no_workspace.compare_plans')"
				:change-target="NEW_TAB"
				is-detailed
				@retry="plan.load"
			/>

			<RegistrationCardField
				v-model:skips="skipsPaymentMethod"
				:element-id="PAYMENT_ELEMENT_ID"
				:policy="paymentMethodPolicy"
				:is-visible="isPaymentStepVisible"
				:plan-name="plan.summary.value?.plan.name ?? null"
				:max-free-workspaces-per-card="
					plan.summary.value?.rules.maxFreeWorkspacesPerCard ?? null
				"
				:error="errorText(cardError)"
			/>

			<LegalAcceptance v-model="hasAcceptedLegal" :error="legalError" />

			<DmsBanner
				v-if="errorMessage"
				tone="error"
				icon="i-ph-warning-circle"
				:title="$t('saas.public.no_workspace.error.failed_title')"
				:description="errorMessage"
				role="alert"
			/>

			<div class="flex flex-wrap items-center justify-between gap-2">
				<UButton
					:label="$t('saas.public.no_workspace.sign_out')"
					icon="i-ph-sign-out"
					color="neutral"
					variant="ghost"
					@click="toLogin"
				/>
				<UButton
					type="submit"
					:loading="isSubmitting"
					:label="
						isSubmitting
							? $t('saas.public.no_workspace.submitting')
							: $t('saas.public.no_workspace.submit')
					"
					icon="i-ph-rocket-launch"
					size="lg"
				/>
			</div>
		</form>
	</PublicStage>
</template>
