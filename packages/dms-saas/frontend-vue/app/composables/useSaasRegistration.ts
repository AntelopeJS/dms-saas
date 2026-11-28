import { readDmsSaasPublicConfig } from '../build/saas-public-config'
import {
	computed,
	type MaybeRefOrGetter,
	onMounted,
	reactive,
	type Ref,
	ref,
	toRef,
	toValue,
} from 'vue'
import { REGISTER_PLAN_PARAM } from '../build/public/routes'
import {
	isPaymentStepShown,
	resolveRegistrationPaymentPolicy,
} from './registrationCardPolicy'
import {
	registrationLandingPath,
	useSaasRegistrationPlan,
} from './useSaasRegistrationPlan'
import {
	REGISTRATION_CARD_REQUIRED_KEY,
	REGISTRATION_LOAD_ERROR_KEY,
} from '../build/public/registration-errors'
import {
	isRegistrationClosedBy,
	missingRegistrationFields,
	type RegistrationExtras,
	type RegistrationField,
	type RegistrationFieldErrors,
	type RegistrationFieldState,
	registrationFieldOf,
	snapshotRegistrationExtras,
} from './registrationRules'

export interface RegistrationForm {
	email: string
	password: string
	name: string
	hasAcceptedLegal: boolean
	/** The visitor chose to add a card later. Only read under `optional`. */
	skipsPaymentMethod: boolean
}

export type RegistrationTranslator = (
	key: string,
	params?: Record<string, string>,
) => string

export interface UseSaasRegistrationOptions {
	/**
	 * In-app route to land on once the workspace is provisioned. Defaults to
	 * sign-in, and from there to the upgrade review on Billing when a paid
	 * plan was chosen. Landing on another origin is the consumer's own call to
	 * make, from the tenant id `submit()` returns.
	 */
	redirectTo?: string
	/**
	 * DOM id the Stripe payment element mounts into. Consumers that render
	 * several registration surfaces on one page must give distinct ids.
	 */
	paymentElementId?: string
	/**
	 * Whatever the consuming SaaS captures on top of the account fields, read
	 * when the visitor submits. It stays the consumer's data: dms-saas forwards
	 * it inside the provisioning transaction, to the consumer's own
	 * `TENANT_BEING_PROVISIONED` listener, and neither reads nor stores it. A
	 * listener that fails to write it cancels the whole registration.
	 *
	 * Keep it to what a form captures — the endpoint is public, so the API caps
	 * its serialised size, depth and number of keys and answers 400 above them.
	 */
	extras?: MaybeRefOrGetter<RegistrationExtras | undefined>
	/** Slug or id of the plan chosen on Pricing; defaults to `?plan=`. */
	plan?: MaybeRefOrGetter<string | null | undefined>
}

interface RegistrationPayload {
	email: string
	password: string
	name: string
	workspaceName: string
	paymentMethodId?: string
	/**
	 * The plan chosen on Pricing: the API opens the workspace on it, awaiting
	 * its first payment, when the card already backs every free workspace it
	 * may.
	 */
	requestedPlanId?: string
	/** The legal checkbox, which the submit guard requires ticked. */
	hasAcceptedLegal: boolean
	extras?: RegistrationExtras
}

/** Everything but the card, which only exists once Stripe has confirmed it. */
type RegistrationSubmission = Omit<RegistrationPayload, 'paymentMethodId'>

interface RegistrationResult {
	tenantId: string
}

interface SetupIntentResponse {
	clientSecret: string | null
}

const SETUP_INTENT_ENDPOINT = '/api/saas/register/setup-intent'
const REGISTER_ENDPOINT = '/api/saas/register'
const DEFAULT_PAYMENT_ELEMENT_ID = 'dms-saas-register-payment-element'
const DEFAULT_WORKSPACE_NAME_KEY = 'saas.public.register.default_workspace_name'
const SUBMIT_ERROR_KEY = 'saas.public.register.error.failed'

function createRegistrationState() {
	return {
		form: reactive<RegistrationForm>({
			email: '',
			password: '',
			name: '',
			hasAcceptedLegal: false,
			skipsPaymentMethod: false,
		}),
		isLoading: ref(true),
		isSubmitting: ref(false),
		hasTriedSubmit: ref(false),
		errorMessage: ref<string | null>(null),
		serverFieldErrors: ref<RegistrationFieldErrors>({}),
	}
}

type RegistrationState = ReturnType<typeof createRegistrationState>

interface RegistrationCardContext {
	state: RegistrationState
	paymentElementId: string
	stripePublishableKey: string | undefined
}

/**
 * The card field's Stripe wiring. A setup intent is not a `useApiData` read:
 * each call creates one, whose client secret is the card form's alone, never
 * cached nor shared. A refusal after the card was confirmed leaves its
 * SetupIntent spent, so `renewCard` puts a fresh one behind the field: the next
 * card would otherwise be refused by Stripe with a bare processing error.
 */
function useRegistrationCard(context: RegistrationCardContext) {
	const { $authFetch } = useAuthFetch()
	const errors = useApiErrorPresenter()
	const { form, serverFieldErrors, errorMessage } = context.state
	const stripeHandle = ref<ReturnType<typeof useStripePaymentElement> | null>(
		null,
	)
	const isPaymentReady = computed(() => stripeHandle.value !== null)

	async function createSetupIntent(): Promise<string | undefined> {
		const setup = await $authFetch<SetupIntentResponse>(SETUP_INTENT_ENDPOINT)
		return setup.clientSecret || undefined
	}

	async function mountPaymentElement(): Promise<void> {
		const publishableKey = context.stripePublishableKey
		if (!publishableKey) return
		const clientSecret = await createSetupIntent()
		if (!clientSecret) return
		stripeHandle.value = useStripePaymentElement({
			publishableKey,
			clientSecret,
			containerId: context.paymentElementId,
			billingEmail: () => form.email,
		})
	}

	async function confirmPaymentMethod(): Promise<string | null> {
		const confirmation = await stripeHandle.value?.confirmAndGetPaymentMethod()
		if (confirmation?.paymentMethodId) return confirmation.paymentMethodId
		serverFieldErrors.value = {
			...serverFieldErrors.value,
			card: confirmation?.error?.message ?? REGISTRATION_CARD_REQUIRED_KEY,
		}
		return null
	}

	async function renewCard(): Promise<void> {
		try {
			const clientSecret = await createSetupIntent()
			if (clientSecret) await stripeHandle.value?.renew(clientSecret)
		} catch (error) {
			errorMessage.value =
				errors.resolveError(error, { fallbackKey: REGISTRATION_LOAD_ERROR_KEY })
					?.message ?? ''
		}
	}

	return {
		isPaymentReady,
		mountPaymentElement,
		confirmPaymentMethod,
		renewCard,
	}
}

interface RegistrationValidationContext {
	state: RegistrationState
	isPaymentRequired: Readonly<Ref<boolean>>
	isPaymentReady: Readonly<Ref<boolean>>
}

/**
 * What the visitor still has to fix, and whether the form may be submitted.
 * The password comes first among the requirements: a card confirmed for a
 * registration the API then refuses would be confirmed for nothing.
 */
function useRegistrationValidation(context: RegistrationValidationContext) {
	const { form, serverFieldErrors, hasTriedSubmit, isSubmitting } =
		context.state

	const fieldState = computed<RegistrationFieldState>(() => ({
		name: form.name,
		email: form.email,
		isPasswordValid: passwordSchema.safeParse(form.password).success,
		isPaymentRequired: context.isPaymentRequired.value,
		isPaymentReady: context.isPaymentReady.value,
		hasAcceptedLegal: form.hasAcceptedLegal,
	}))

	const missingFields = computed(() =>
		missingRegistrationFields(fieldState.value),
	)

	const fieldErrors = computed<RegistrationFieldErrors>(() => {
		const shown: RegistrationFieldErrors = hasTriedSubmit.value
			? missingFields.value
			: {}
		return { ...shown, ...serverFieldErrors.value }
	})

	const fieldErrorCount = computed(() => Object.keys(fieldErrors.value).length)

	const missingRequirement = computed(
		() => Object.values(missingFields.value)[0] ?? null,
	)

	const canSubmit = computed(
		() => !isSubmitting.value && missingRequirement.value === null,
	)

	function clearServerError(field: RegistrationField): void {
		if (!serverFieldErrors.value[field]) return
		const { [field]: _cleared, ...rest } = serverFieldErrors.value
		serverFieldErrors.value = rest
	}

	return {
		fieldErrors,
		fieldErrorCount,
		missingRequirement,
		canSubmit,
		clearServerError,
	}
}

interface RegistrationSubmitContext {
	state: RegistrationState
	options: UseSaasRegistrationOptions
	plan: ReturnType<typeof useSaasRegistrationPlan>
	card: ReturnType<typeof useRegistrationCard>
	missingRequirement: Readonly<Ref<string | null>>
	isPaymentStepVisible: Readonly<Ref<boolean>>
}

/**
 * Confirms the card when one is collected, provisions the workspace and lands
 * on the configured route. Everything the caller needs to know travels through
 * `errorMessage` and `fieldErrors`: nothing throws, so a consumer template can
 * bind the action directly. The action returns the tenant id when the workspace
 * was provisioned, null otherwise.
 *
 * A card is confirmed and an account created in it, so a second call while the
 * first is in flight does nothing. The form is captured whole, before the card
 * confirmation, which can hold a 3-D Secure challenge open for seconds while
 * the fields stay editable: a payload half read before and half after would
 * not be the one the visitor sent. The capture sits inside the guard, since
 * freezing it reads the consumer's object, which is never guaranteed to be
 * serialisable. Once the workspace exists, whatever failed after it is a
 * landing problem: calling it a failed registration would send the visitor
 * back through a flow that creates a second account.
 */
function useRegistrationSubmit(context: RegistrationSubmitContext) {
	const { $authFetch } = useAuthFetch()
	const errors = useApiErrorPresenter()
	const { $i18n } = useDmsApp()
	const {
		form,
		isSubmitting,
		hasTriedSubmit,
		errorMessage,
		serverFieldErrors,
	} = context.state

	const translate: RegistrationTranslator = (key, params) =>
		params ? $i18n.t(key, params) : $i18n.t(key)

	function captureSubmission(): RegistrationSubmission {
		return {
			email: form.email.trim(),
			password: form.password,
			name: form.name.trim(),
			workspaceName: translate(DEFAULT_WORKSPACE_NAME_KEY, {
				name: form.name.trim(),
			}),
			requestedPlanId: context.plan.summary.value?.requestedPlan?._id,
			hasAcceptedLegal: form.hasAcceptedLegal,
			extras: snapshotRegistrationExtras(toValue(context.options.extras)),
		}
	}

	async function provision(
		submission: RegistrationSubmission,
		paymentMethodId: string | undefined,
	): Promise<string | null> {
		const result = await $authFetch<RegistrationResult>(REGISTER_ENDPOINT, {
			method: 'POST',
			body: { ...submission, paymentMethodId },
		})
		return result.tenantId ?? null
	}

	return async function submit(): Promise<string | null> {
		if (isSubmitting.value) return null
		hasTriedSubmit.value = true
		serverFieldErrors.value = {}
		errorMessage.value = null
		if (context.missingRequirement.value) return null

		isSubmitting.value = true
		let tenantId: string | null = null
		let paymentMethodId: string | null | undefined
		try {
			const submission = captureSubmission()
			paymentMethodId = context.isPaymentStepVisible.value
				? await context.card.confirmPaymentMethod()
				: undefined
			if (paymentMethodId === null) return null
			tenantId = await provision(submission, paymentMethodId)
			if (tenantId) {
				await navigateDms(
					context.options.redirectTo ??
						registrationLandingPath(context.plan.summary.value),
				)
			}
			return tenantId
		} catch (error) {
			if (tenantId) return tenantId
			const key = readApiErrorKey(error)
			const field = registrationFieldOf(key)
			if (key && field) {
				serverFieldErrors.value = { ...serverFieldErrors.value, [field]: key }
			} else {
				errorMessage.value =
					errors.resolveError(error, { fallbackKey: SUBMIT_ERROR_KEY })
						?.message ?? ''
			}
			if (paymentMethodId) await context.card.renewCard()
			return null
		} finally {
			isSubmitting.value = false
		}
	}
}

/**
 * The public registration flow, without a single line of presentation.
 *
 * Registration is short on purpose: an account, the legal acceptance and —
 * when the deployment asks for one — a card. The workspace it opens lands on
 * the free plan under a default name; a paid plan chosen on Pricing is
 * reviewed on Billing right after, where plan, customer type and billing
 * address are collected.
 *
 * dms-saas owns what is dangerous to re-derive — the card policy, the Stripe
 * setup intent and card confirmation, the order the fields are validated in,
 * the shape of the provisioning call, the mapping from API failures to a
 * field — and hands the consumer plain state to bind and one action to call.
 * Each SaaS then writes the markup its conversion funnel needs.
 *
 * The screen shipped in this package is one consumer among others: replace it
 * by turning it off (`publicScreens.register: false` in the module config) and
 * registering your own page on the `register` slug, then build the markup you
 * want on this composable rather than forking its logic.
 *
 * The state it hands back: `isRegistrationClosed` for registration by
 * invitation only, which renders the closed state, not the form;
 * `paymentMethodPolicy`, the one the backend applies once the plan summary has
 * loaded; `canSkipPaymentMethod`, whether the screen should offer to add the
 * card later; `isPaymentStepVisible`, which the card field's visibility binds
 * to with `v-show`, not `v-if`; `isPaymentReady`, whether the card field has
 * been wired to Stripe, false as long as the publishable key or the setup
 * intent is missing; `passwordStrength`, DMS's password rules scored for
 * `<DmsPasswordRules>`, which the API holds the password to as well; and
 * `fieldErrors`, the errors to show next to each field: what is still missing
 * once the visitor tried to submit, and what the server refused.
 *
 * `submit` confirms the card when one is collected, provisions the workspace
 * and lands on the configured route, and returns the tenant id, or null when
 * nothing was provisioned. Closed registration and a card-less policy never
 * reach Stripe: the setup intent would only answer 403 or 400.
 *
 * @param options Landing route, payment element id, extras and chosen plan
 * @returns Bindable form state, card policy, plan, submission action and status
 */
export function useSaasRegistration(options: UseSaasRegistrationOptions = {}) {
	const errors = useApiErrorPresenter()
	const config = useDmsRuntimeConfig()
	const route = useDmsRoute()

	const paymentElementId =
		options.paymentElementId ?? DEFAULT_PAYMENT_ELEMENT_ID
	const published = config.public.dmsSaas
	const saasConfig = readDmsSaasPublicConfig(published)

	const state = createRegistrationState()
	const { form, isLoading, isSubmitting, errorMessage } = state
	const plan = useSaasRegistrationPlan(
		options.plan ?? (() => readQueryString(route.query[REGISTER_PLAN_PARAM])),
	)

	const isRegistrationClosed = isRegistrationClosedBy(saasConfig)
	const paymentMethodPolicy = computed(() =>
		resolveRegistrationPaymentPolicy(saasConfig, plan.summary.value),
	)
	const canSkipPaymentMethod = computed(
		() => paymentMethodPolicy.value === 'optional',
	)
	const isPaymentStepVisible = computed(() =>
		isPaymentStepShown(paymentMethodPolicy.value, form.skipsPaymentMethod),
	)
	const card = useRegistrationCard({
		state,
		paymentElementId,
		stripePublishableKey: saasConfig?.stripePublishableKey,
	})
	const passwordStrength = usePasswordStrength(toRef(form, 'password'))
	const validation = useRegistrationValidation({
		state,
		isPaymentRequired: isPaymentStepVisible,
		isPaymentReady: card.isPaymentReady,
	})
	const submit = useRegistrationSubmit({
		state,
		options,
		plan,
		card,
		missingRequirement: validation.missingRequirement,
		isPaymentStepVisible,
	})

	onMounted(async () => {
		if (isRegistrationClosed) {
			isLoading.value = false
			return
		}
		await plan.load()
		if (paymentMethodPolicy.value === 'none') {
			isLoading.value = false
			return
		}
		try {
			await card.mountPaymentElement()
		} catch (error) {
			errorMessage.value =
				errors.resolveError(error, { fallbackKey: REGISTRATION_LOAD_ERROR_KEY })
					?.message ?? ''
		} finally {
			isLoading.value = false
		}
	})

	return {
		...validation,
		form,
		paymentElementId,
		paymentMethodPolicy,
		canSkipPaymentMethod,
		isPaymentStepVisible,
		isPaymentReady: card.isPaymentReady,
		passwordStrength,
		isRegistrationClosed,
		isLoading,
		isSubmitting,
		errorMessage,
		submit,
		planSummary: plan.summary,
		isPlanLoading: plan.isLoading,
		planLoadError: plan.loadError,
		reloadPlan: plan.load,
	}
}

function readQueryString(
	value: string | null | undefined | (string | null)[],
): string | null {
	return value && !Array.isArray(value) ? value : null
}
