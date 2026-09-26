import {
  computed,
  type MaybeRefOrGetter,
  onMounted,
  reactive,
  ref,
  toValue,
} from "vue";

/**
 * Whether registration asks for a card, as the deployment configured it in
 * `registration.paymentMethod`: `required` always does, `optional` lets the
 * visitor skip it, `none` never shows the card step and never calls Stripe.
 */
export type RegistrationPaymentMethodPolicy = "required" | "optional" | "none";

export interface RegistrationForm {
  email: string;
  password: string;
  name: string;
  hasAcceptedLegal: boolean;
  /** The visitor chose to add a card later. Only read under `optional`. */
  skipsPaymentMethod: boolean;
}

/** Everything the submit guard looks at, independent of how it is bound. */
export interface RegistrationRequirements {
  isPaymentRequired: boolean;
  isPaymentReady: boolean;
  hasAcceptedLegal: boolean;
}

export type RegistrationTranslator = (
  key: string,
  params?: Record<string, string>,
) => string;

export interface UseSaasRegistrationOptions {
  /**
   * In-app route to land on once the workspace is provisioned. Landing on
   * another origin is the consumer's own call to make, from the tenant id
   * `submit()` returns.
   */
  redirectTo?: string;
  /**
   * DOM id the Stripe payment element mounts into. Consumers that render
   * several registration surfaces on one page must give distinct ids.
   */
  paymentElementId?: string;
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
  extras?: MaybeRefOrGetter<Record<string, unknown> | undefined>;
}

interface RegistrationRequirement {
  errorKey: string;
  isMet: (requirements: RegistrationRequirements) => boolean;
}

interface RegistrationPayload {
  email: string;
  password: string;
  name: string;
  workspaceName: string;
  paymentMethodId?: string;
  extras?: Record<string, unknown>;
}

/** Everything but the card, which only exists once Stripe has confirmed it. */
type RegistrationSubmission = Omit<RegistrationPayload, "paymentMethodId">;

interface RegistrationResult {
  tenantId: string;
}

interface SetupIntentResponse {
  clientSecret: string | null;
}

/** What dms-saas publishes to the browser through the frontend module options. */
export interface DmsSaasPublicRuntimeConfig {
  stripePublishableKey?: string;
  admissionMode?: "open" | "invitation-only";
  registrationPaymentMethod?: RegistrationPaymentMethodPolicy;
}

type PaymentStepRule = (skipsPaymentMethod: boolean) => boolean;

const SETUP_INTENT_ENDPOINT = "/api/saas/register/setup-intent";
const REGISTER_ENDPOINT = "/api/saas/register";
const DEFAULT_PAYMENT_ELEMENT_ID = "dms-saas-register-payment-element";
const DEFAULT_REDIRECT = "/auth/login";
const DEFAULT_PAYMENT_POLICY: RegistrationPaymentMethodPolicy = "required";
const INVITATION_ONLY = "invitation-only";
const DEFAULT_WORKSPACE_NAME_KEY = "saas.register.default_workspace_name";
const NO_PAYMENT_ERROR_KEY = "saas.register.error.no_payment";
const LOAD_ERROR_KEY = "saas.register.error.load";
const SUBMIT_ERROR_KEY = "saas.register.error.failed";

const PAYMENT_STEP_RULES: Record<RegistrationPaymentMethodPolicy, PaymentStepRule> =
  {
    required: () => true,
    optional: (skipsPaymentMethod) => !skipsPaymentMethod,
    none: () => false,
  };

/**
 * Checked in the order the visitor can act on them: the card field comes
 * before the legal checkbox on every screen.
 */
const REGISTRATION_REQUIREMENTS: RegistrationRequirement[] = [
  {
    errorKey: NO_PAYMENT_ERROR_KEY,
    isMet: (requirements) =>
      !requirements.isPaymentRequired || requirements.isPaymentReady,
  },
  {
    errorKey: "saas.register.error.legal_required",
    isMet: (requirements) => requirements.hasAcceptedLegal,
  },
];

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
  const missing = REGISTRATION_REQUIREMENTS.find(
    (requirement) => !requirement.isMet(requirements),
  );
  return missing?.errorKey ?? null;
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
  const policy = config?.registrationPaymentMethod;
  return policy && policy in PAYMENT_STEP_RULES ? policy : DEFAULT_PAYMENT_POLICY;
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
  return PAYMENT_STEP_RULES[policy](skipsPaymentMethod);
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
  return config?.admissionMode === INVITATION_ONLY;
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
  if (!extras || Object.keys(extras).length === 0) return undefined;
  return JSON.parse(JSON.stringify(extras)) as Record<string, unknown>;
}

/**
 * The public registration flow, without a single line of presentation.
 *
 * Registration is short on purpose: an account, the legal acceptance and —
 * when the deployment asks for one — a card. The workspace it opens lands on
 * the free plan under a default name; plan, customer type and billing address
 * are collected by the upgrade flow.
 *
 * dms-saas owns what is dangerous to re-derive — the card policy, the Stripe
 * setup intent and card confirmation, the order the fields are validated in,
 * the shape of the provisioning call, the mapping from API failures to a
 * message — and hands the consumer plain state to bind and one action to
 * call. Each SaaS then writes the markup its conversion funnel needs.
 *
 * The screen shipped in this package is one consumer among others: replace it
 * by turning it off (`publicScreens.register: false` in the module config) and
 * registering your own page on the `register` slug, then build the markup you
 * want on this composable rather than forking its logic.
 *
 * @param options Landing route and payment element id
 * @returns Bindable form state, card policy, submission action and status
 */
export function useSaasRegistration(options: UseSaasRegistrationOptions = {}) {
  const { $authFetch } = useAuthFetch();
  const { resolveApiError } = useApiErrorMessage();
  const { $i18n } = useDmsApp();
  const config = useDmsRuntimeConfig();

  const translate: RegistrationTranslator = (key, params) =>
    params ? $i18n.t(key, params) : $i18n.t(key);

  const paymentElementId =
    options.paymentElementId ?? DEFAULT_PAYMENT_ELEMENT_ID;
  const redirectTo = options.redirectTo ?? DEFAULT_REDIRECT;
  const saasConfig = config.public.dmsSaas as
    | DmsSaasPublicRuntimeConfig
    | undefined;

  const form = reactive<RegistrationForm>({
    email: "",
    password: "",
    name: "",
    hasAcceptedLegal: false,
    skipsPaymentMethod: false,
  });

  const isLoading = ref(true);
  const isSubmitting = ref(false);
  const errorMessage = ref<string | null>(null);
  const stripeHandle = ref<ReturnType<typeof useStripePaymentElement> | null>(
    null,
  );

  /** Registration by invitation only: render the closed state, not the form. */
  const isRegistrationClosed = isRegistrationClosedBy(saasConfig);
  const paymentMethodPolicy = resolveRegistrationPaymentPolicy(saasConfig);
  /** Whether the screen should offer to add the card later. */
  const canSkipPaymentMethod = paymentMethodPolicy === "optional";

  /** Bind the card field's visibility to this, with `v-show`, not `v-if`. */
  const isPaymentStepVisible = computed(() =>
    isPaymentStepShown(paymentMethodPolicy, form.skipsPaymentMethod),
  );

  /**
   * Whether the card field has been wired to Stripe — false as long as the
   * publishable key or the setup intent is missing.
   */
  const isPaymentReady = computed(() => stripeHandle.value !== null);

  const requirements = computed<RegistrationRequirements>(() => ({
    isPaymentRequired: isPaymentStepVisible.value,
    isPaymentReady: isPaymentReady.value,
    hasAcceptedLegal: form.hasAcceptedLegal,
  }));

  const missingRequirement = computed(() =>
    firstMissingRegistrationRequirement(requirements.value),
  );

  const canSubmit = computed(
    () => !isSubmitting.value && missingRequirement.value === null,
  );

  async function mountPaymentElement(): Promise<void> {
    const publishableKey = saasConfig?.stripePublishableKey;
    if (!publishableKey) return;
    const setup = await $authFetch<SetupIntentResponse>(SETUP_INTENT_ENDPOINT);
    if (!setup.clientSecret) return;
    stripeHandle.value = useStripePaymentElement({
      publishableKey,
      clientSecret: setup.clientSecret,
      containerId: paymentElementId,
    });
  }

  async function confirmPaymentMethod(): Promise<string | null> {
    const confirmation = await stripeHandle.value?.confirmAndGetPaymentMethod();
    if (confirmation?.paymentMethodId) return confirmation.paymentMethodId;
    errorMessage.value =
      confirmation?.error?.message ?? translate(NO_PAYMENT_ERROR_KEY);
    return null;
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
      email: form.email,
      password: form.password,
      name: form.name,
      workspaceName: translate(DEFAULT_WORKSPACE_NAME_KEY, {
        name: form.name.trim(),
      }),
      extras: snapshotRegistrationExtras(toValue(options.extras)),
    };
  }

  /**
   * Confirm the card when one is collected, provision the workspace, land on
   * the configured route.
   *
   * Everything the caller needs to know travels through `errorMessage`:
   * nothing throws, so a consumer template can bind the action directly.
   *
   * @returns Tenant id when the workspace was provisioned, null otherwise
   */
  async function submit(): Promise<string | null> {
    // A card is confirmed and an account created in here: a second call while
    // the first is in flight would run both again.
    if (isSubmitting.value) return null;

    if (missingRequirement.value) {
      errorMessage.value = translate(missingRequirement.value);
      return null;
    }

    errorMessage.value = null;
    isSubmitting.value = true;
    let tenantId: string | null = null;
    try {
      // Inside the guard: freezing the capture reads the consumer's object,
      // and a consumer's object is never guaranteed to be serialisable.
      const submission = captureSubmission();
      const paymentMethodId = isPaymentStepVisible.value
        ? await confirmPaymentMethod()
        : undefined;
      if (paymentMethodId === null) return null;

      const result = await $authFetch<RegistrationResult>(REGISTER_ENDPOINT, {
        method: "POST",
        body: { ...submission, paymentMethodId },
      });

      tenantId = result.tenantId ?? null;
      if (tenantId) await navigateDms(redirectTo);
      return tenantId;
    } catch (error) {
      // Once the workspace exists, whatever failed after it is a landing
      // problem: calling it a failed registration sends the visitor back
      // through a flow that would create a second account.
      if (tenantId) return tenantId;
      errorMessage.value = resolveApiError(error, SUBMIT_ERROR_KEY);
      return null;
    } finally {
      isSubmitting.value = false;
    }
  }

  onMounted(async () => {
    // Closed registration and a card-less policy never reach Stripe: the
    // setup intent would only answer 403 or 400.
    if (isRegistrationClosed || paymentMethodPolicy === "none") {
      isLoading.value = false;
      return;
    }
    try {
      await mountPaymentElement();
    } catch (error) {
      errorMessage.value = resolveApiError(error, LOAD_ERROR_KEY);
    } finally {
      isLoading.value = false;
    }
  });

  return {
    form,
    paymentElementId,
    paymentMethodPolicy,
    canSkipPaymentMethod,
    isPaymentStepVisible,
    isPaymentReady,
    isRegistrationClosed,
    isLoading,
    isSubmitting,
    errorMessage,
    missingRequirement,
    canSubmit,
    submit,
  };
}
