import {
	computed,
	type MaybeRefOrGetter,
	onMounted,
	reactive,
	ref,
	toRef,
	toValue,
} from 'vue'
import { rememberChosenPlan } from '../build/public/chosen-plan'
import {
	isPaidPlan,
	type RegistrationPlanSummary,
} from '../build/public/pricing'
import {
	billingUpgradePath,
	LOGIN_PATH,
	loginPathThen,
	REGISTER_PLAN_PARAM,
} from '../build/public/routes'
import { usePublicFetch } from '../build/public/usePublicFetch'

export interface RegistrationForm {
	email: string
	password: string
	name: string
	hasAcceptedLegal: boolean
	/** The visitor chose to add a card later. Only read under `optional`. */
	skipsPaymentMethod: boolean
}

/** Everything the submit guard looks at, independent of how it is bound. */
export interface RegistrationRequirements {
	isPaymentRequired: boolean
	isPaymentReady: boolean
	hasAcceptedLegal: boolean
}

/** The account fields on top of the requirements, for field-level errors. */
export interface RegistrationFieldState extends RegistrationRequirements {
	name: string
	email: string
	isPasswordValid: boolean
}

/** A field of the registration form an error can be attached to. */
export type RegistrationField = 'name' | 'email' | 'password' | 'card' | 'legal'

/** Translation key of each field's error, for the fields that have one. */
export type RegistrationFieldErrors = Partial<Record<RegistrationField, string>>

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
	extras?: MaybeRefOrGetter<Record<string, unknown> | undefined>
	/** Slug or id of the plan chosen on Pricing; defaults to `?plan=`. */
	plan?: MaybeRefOrGetter<string | null | undefined>
}

interface RegistrationRule {
	field: RegistrationField
	errorKey: string
	isMet: (state: RegistrationFieldState) => boolean
}

interface RegistrationPayload {
	email: string
	password: string
	name: string
	workspaceName: string
	paymentMethodId?: string
	extras?: Record<string, unknown>
}

/** Everything but the card, which only exists once Stripe has confirmed it. */
type RegistrationSubmission = Omit<RegistrationPayload, 'paymentMethodId'>

interface RegistrationResult {
	tenantId: string
}

interface SetupIntentResponse {
	clientSecret: string | null
}

type PaymentStepRule = (skipsPaymentMethod: boolean) => boolean

const SETUP_INTENT_ENDPOINT = '/api/saas/register/setup-intent'
const REGISTER_ENDPOINT = '/api/saas/register'
const REGISTRATION_PLAN_ENDPOINT = '/api/saas/register/plan'
const DEFAULT_PAYMENT_ELEMENT_ID = 'dms-saas-register-payment-element'
const DEFAULT_PAYMENT_POLICY: RegistrationPaymentMethodPolicy = 'required'
const INVITATION_ONLY = 'invitation-only'
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const DEFAULT_WORKSPACE_NAME_KEY = 'saas.public.register.default_workspace_name'
const NO_PAYMENT_ERROR_KEY = 'saas.public.register.error.card_required'
const LOAD_ERROR_KEY = 'saas.public.register.error.load'
const SUBMIT_ERROR_KEY = 'saas.public.register.error.failed'
const PASSWORD_POLICY_ERROR_KEY = 'saas.errors.registration.password_policy'

const PAYMENT_STEP_RULES: Record<
	RegistrationPaymentMethodPolicy,
	PaymentStepRule
> = {
	required: () => true,
	optional: (skipsPaymentMethod) => !skipsPaymentMethod,
	none: () => false,
}

/**
 * Checked in the order the visitor can act on them: the card field comes
 * before the legal checkbox on every screen.
 */
const REGISTRATION_REQUIREMENTS: RegistrationRule[] = [
	{
		field: 'card',
		errorKey: NO_PAYMENT_ERROR_KEY,
		isMet: (state) => !state.isPaymentRequired || state.isPaymentReady,
	},
	{
		field: 'legal',
		errorKey: 'saas.public.register.error.legal_required',
		isMet: (state) => state.hasAcceptedLegal,
	},
]

/** The account fields, in form order, ahead of the requirements. */
const ACCOUNT_RULES: RegistrationRule[] = [
	{
		field: 'name',
		errorKey: 'saas.public.register.error.name_required',
		isMet: (state) => state.name.trim().length > 0,
	},
	{
		field: 'email',
		errorKey: 'saas.public.register.error.email_invalid',
		isMet: (state) => EMAIL_PATTERN.test(state.email.trim()),
	},
	{
		field: 'password',
		errorKey: PASSWORD_POLICY_ERROR_KEY,
		isMet: (state) => state.isPasswordValid,
	},
]

/**
 * The server's refusals that are about one field: shown next to it rather
 * than above the form.
 */
const API_ERROR_FIELDS: Record<string, RegistrationField> = {
	'saas.errors.user.email_in_use': 'email',
	'saas.errors.registration.password_policy': 'password',
	'saas.errors.registration.payment_method_required': 'card',
	'saas.errors.workspace.free_card_limit_reached': 'card',
}

/**
 * The one guard a consumer cannot get wrong on its own: the first requirement
 * the visitor has not met yet, in the order they can act on them.
 *
 * @param requirements Current state of the registration form
 * @returns Translation key of the first unmet requirement, or null
 */
export function firstMissingRegistrationRequirement(
	requirements: RegistrationRequirements,
): string | null {
	const state = { ...requirements, name: '', email: '', isPasswordValid: true }
	const missing = REGISTRATION_REQUIREMENTS.find((rule) => !rule.isMet(state))
	return missing?.errorKey ?? null
}

/**
 * Every field the visitor still has to fix, each with its error key, so the
 * form can mark them all at once and count them in its summary.
 *
 * @param state Current state of the registration form
 */
export function missingRegistrationFields(
	state: RegistrationFieldState,
): RegistrationFieldErrors {
	return Object.fromEntries(
		[...ACCOUNT_RULES, ...REGISTRATION_REQUIREMENTS]
			.filter((rule) => !rule.isMet(state))
			.map((rule) => [rule.field, rule.errorKey]),
	)
}

/** The field a server refusal is about, or null for a form-wide failure. */
export function registrationFieldOf(
	errorKey: string | undefined,
): RegistrationField | null {
	return (errorKey && API_ERROR_FIELDS[errorKey]) || null
}

/**
 * The card policy the deployment published, falling back to the backend's
 * own default when it published none.
 *
 * @param config dms-saas public runtime config
 * @returns The configured policy, or `required`
 */
export function resolveRegistrationPaymentPolicy(
	config: DmsSaasPublicRuntimeConfig | undefined,
): RegistrationPaymentMethodPolicy {
	const policy = config?.registrationPaymentMethod
	return policy && policy in PAYMENT_STEP_RULES
		? policy
		: DEFAULT_PAYMENT_POLICY
}

/**
 * Whether the registration still collects a card.
 *
 * @param policy Configured card policy
 * @param skipsPaymentMethod Whether the visitor chose to add a card later
 * @returns True when the card step is shown and must be completed
 */
export function isPaymentStepShown(
	policy: RegistrationPaymentMethodPolicy,
	skipsPaymentMethod: boolean,
): boolean {
	return PAYMENT_STEP_RULES[policy](skipsPaymentMethod)
}

/**
 * Whether the deployment has closed public registration to invitations.
 *
 * @param config dms-saas public runtime config
 * @returns True when only invited accounts may sign up
 */
export function isRegistrationClosedBy(
	config: DmsSaasPublicRuntimeConfig | undefined,
): boolean {
	return config?.admissionMode === INVITATION_ONLY
}

/**
 * Where a new account lands: sign-in, then the upgrade review on Billing
 * when the visitor chose a paid plan on Pricing.
 *
 * @param summary The registration plan summary, when it loaded
 */
export function registrationLandingPath(
	summary: RegistrationPlanSummary | null,
): string {
	const requested = summary?.requestedPlan
	if (!requested || !isPaidPlan(requested)) return LOGIN_PATH
	return loginPathThen(billingUpgradePath(requested._id))
}

/**
 * The consumer's capture, detached from the consumer.
 *
 * An empty capture is no capture, and a live one is not a capture at all: the
 * object is frozen as it will be serialised, so a consumer whose own form is
 * still editable while the card is being confirmed cannot change what was
 * submitted — or make it too large to accept once the card has gone through.
 *
 * @param extras Whatever the consumer handed over, possibly reactive
 * @returns A detached copy, or undefined when there is nothing to send
 */
export function snapshotRegistrationExtras(
	extras: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
	if (!extras || Object.keys(extras).length === 0) return undefined
	return JSON.parse(JSON.stringify(extras)) as Record<string, unknown>
}

/**
 * The plan a registration opens the workspace on, and the one chosen on
 * Pricing, loaded for display. The chosen plan is remembered for the tab, so
 * the OAuth round-trip back to "Set up your first workspace" keeps it.
 *
 * @param planReference Slug or id of the chosen plan
 */
export function useSaasRegistrationPlan(
	planReference: MaybeRefOrGetter<string | null | undefined>,
) {
	const publicFetch = usePublicFetch()
	const { resolveApiError } = useApiErrorMessage()
	const summary = ref<RegistrationPlanSummary | null>(null)
	const isLoading = ref(false)
	const loadError = ref<string | null>(null)

	async function load(): Promise<void> {
		isLoading.value = true
		loadError.value = null
		const plan = toValue(planReference) || undefined
		try {
			summary.value = await publicFetch<RegistrationPlanSummary>(
				REGISTRATION_PLAN_ENDPOINT,
				{ query: plan ? { [REGISTER_PLAN_PARAM]: plan } : {} },
			)
			rememberChosenPlan(summary.value.requestedPlan?._id ?? null)
		} catch (error) {
			loadError.value = resolveApiError(error, LOAD_ERROR_KEY)
		} finally {
			isLoading.value = false
		}
	}

	return { summary, isLoading, loadError, load }
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
 * @param options Landing route, payment element id, extras and chosen plan
 * @returns Bindable form state, card policy, plan, submission action and status
 */
export function useSaasRegistration(options: UseSaasRegistrationOptions = {}) {
	const { $authFetch } = useAuthFetch()
	const { resolveApiError } = useApiErrorMessage()
	const { $i18n } = useDmsApp()
	const config = useDmsRuntimeConfig()
	const route = useDmsRoute()

	const translate: RegistrationTranslator = (key, params) =>
		params ? $i18n.t(key, params) : $i18n.t(key)

	const paymentElementId =
		options.paymentElementId ?? DEFAULT_PAYMENT_ELEMENT_ID
	const saasConfig = config.public.dmsSaas as
		| DmsSaasPublicRuntimeConfig
		| undefined

	const form = reactive<RegistrationForm>({
		email: '',
		password: '',
		name: '',
		hasAcceptedLegal: false,
		skipsPaymentMethod: false,
	})

	const isLoading = ref(true)
	const isSubmitting = ref(false)
	const hasTriedSubmit = ref(false)
	const errorMessage = ref<string | null>(null)
	const serverFieldErrors = ref<RegistrationFieldErrors>({})
	const stripeHandle = ref<ReturnType<typeof useStripePaymentElement> | null>(
		null,
	)
	const plan = useSaasRegistrationPlan(
		options.plan ?? (() => readQueryString(route.query[REGISTER_PLAN_PARAM])),
	)

	/** Registration by invitation only: render the closed state, not the form. */
	const isRegistrationClosed = isRegistrationClosedBy(saasConfig)
	const paymentMethodPolicy = resolveRegistrationPaymentPolicy(saasConfig)
	/** Whether the screen should offer to add the card later. */
	const canSkipPaymentMethod = paymentMethodPolicy === 'optional'

	/** Bind the card field's visibility to this, with `v-show`, not `v-if`. */
	const isPaymentStepVisible = computed(() =>
		isPaymentStepShown(paymentMethodPolicy, form.skipsPaymentMethod),
	)

	/**
	 * Whether the card field has been wired to Stripe — false as long as the
	 * publishable key or the setup intent is missing.
	 */
	const isPaymentReady = computed(() => stripeHandle.value !== null)

	/**
	 * DMS's password rules, scored for `<DmsPasswordRules>`. The API holds the
	 * password to the same policy.
	 */
	const passwordStrength = usePasswordStrength(toRef(form, 'password'))

	const fieldState = computed<RegistrationFieldState>(() => ({
		name: form.name,
		email: form.email,
		isPasswordValid: passwordSchema.safeParse(form.password).success,
		isPaymentRequired: isPaymentStepVisible.value,
		isPaymentReady: isPaymentReady.value,
		hasAcceptedLegal: form.hasAcceptedLegal,
	}))

	const missingFields = computed(() =>
		missingRegistrationFields(fieldState.value),
	)

	/**
	 * The errors to show next to each field: what is still missing once the
	 * visitor tried to submit, and what the server refused.
	 */
	const fieldErrors = computed<RegistrationFieldErrors>(() => ({
		...(hasTriedSubmit.value ? missingFields.value : {}),
		...serverFieldErrors.value,
	}))

	const fieldErrorCount = computed(() => Object.keys(fieldErrors.value).length)

	// The password comes first: a card confirmed for a registration the API
	// then refuses would be confirmed for nothing.
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

	async function mountPaymentElement(): Promise<void> {
		const publishableKey = saasConfig?.stripePublishableKey
		if (!publishableKey) return
		const setup = await $authFetch<SetupIntentResponse>(SETUP_INTENT_ENDPOINT)
		if (!setup.clientSecret) return
		stripeHandle.value = useStripePaymentElement({
			publishableKey,
			clientSecret: setup.clientSecret,
			containerId: paymentElementId,
			billingEmail: () => form.email,
		})
	}

	async function confirmPaymentMethod(): Promise<string | null> {
		const confirmation = await stripeHandle.value?.confirmAndGetPaymentMethod()
		if (confirmation?.paymentMethodId) return confirmation.paymentMethodId
		serverFieldErrors.value = {
			...serverFieldErrors.value,
			card: confirmation?.error?.message ?? NO_PAYMENT_ERROR_KEY,
		}
		return null
	}

	/**
	 * The form as it stood when the visitor submitted.
	 *
	 * Taken whole, before the card confirmation: that step can hold a 3-D Secure
	 * challenge open for seconds while the fields stay editable, and a payload
	 * half read before and half after would not be the one the visitor sent.
	 */
	function captureSubmission(): RegistrationSubmission {
		return {
			email: form.email.trim(),
			password: form.password,
			name: form.name.trim(),
			workspaceName: translate(DEFAULT_WORKSPACE_NAME_KEY, {
				name: form.name.trim(),
			}),
			extras: snapshotRegistrationExtras(toValue(options.extras)),
		}
	}

	function reportFailure(error: unknown): void {
		const field = registrationFieldOf(readApiErrorKey(error))
		if (!field) {
			errorMessage.value = resolveApiError(error, SUBMIT_ERROR_KEY)
			return
		}
		serverFieldErrors.value = {
			...serverFieldErrors.value,
			[field]: readApiErrorKey(error)!,
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

	/**
	 * Confirm the card when one is collected, provision the workspace, land on
	 * the configured route.
	 *
	 * Everything the caller needs to know travels through `errorMessage` and
	 * `fieldErrors`: nothing throws, so a consumer template can bind the action
	 * directly.
	 *
	 * @returns Tenant id when the workspace was provisioned, null otherwise
	 */
	async function submit(): Promise<string | null> {
		// A card is confirmed and an account created in here: a second call while
		// the first is in flight would run both again.
		if (isSubmitting.value) return null
		hasTriedSubmit.value = true
		serverFieldErrors.value = {}
		errorMessage.value = null
		if (missingRequirement.value) return null

		isSubmitting.value = true
		let tenantId: string | null = null
		try {
			// Inside the guard: freezing the capture reads the consumer's object,
			// and a consumer's object is never guaranteed to be serialisable.
			const submission = captureSubmission()
			const paymentMethodId = isPaymentStepVisible.value
				? await confirmPaymentMethod()
				: undefined
			if (paymentMethodId === null) return null
			tenantId = await provision(submission, paymentMethodId)
			if (tenantId) {
				await navigateDms(
					options.redirectTo ?? registrationLandingPath(plan.summary.value),
				)
			}
			return tenantId
		} catch (error) {
			// Once the workspace exists, whatever failed after it is a landing
			// problem: calling it a failed registration sends the visitor back
			// through a flow that would create a second account.
			if (tenantId) return tenantId
			reportFailure(error)
			return null
		} finally {
			isSubmitting.value = false
		}
	}

	onMounted(async () => {
		// Closed registration and a card-less policy never reach Stripe: the
		// setup intent would only answer 403 or 400.
		if (isRegistrationClosed) {
			isLoading.value = false
			return
		}
		void plan.load()
		if (paymentMethodPolicy === 'none') {
			isLoading.value = false
			return
		}
		try {
			await mountPaymentElement()
		} catch (error) {
			errorMessage.value = resolveApiError(error, LOAD_ERROR_KEY)
		} finally {
			isLoading.value = false
		}
	})

	return {
		form,
		paymentElementId,
		paymentMethodPolicy,
		canSkipPaymentMethod,
		isPaymentStepVisible,
		isPaymentReady,
		passwordStrength,
		isRegistrationClosed,
		isLoading,
		isSubmitting,
		errorMessage,
		fieldErrors,
		fieldErrorCount,
		clearServerError,
		missingRequirement,
		canSubmit,
		submit,
		planSummary: plan.summary,
		isPlanLoading: plan.isLoading,
		planLoadError: plan.loadError,
		reloadPlan: plan.load,
	}
}

function readQueryString(value: unknown): string | null {
	return typeof value === 'string' && value.length > 0 ? value : null
}
