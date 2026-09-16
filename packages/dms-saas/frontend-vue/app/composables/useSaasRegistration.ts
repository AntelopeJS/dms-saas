import {
  computed,
  type MaybeRefOrGetter,
  onMounted,
  reactive,
  ref,
  toValue,
  watch,
} from "vue";
import { formatMajorUnits } from "./useMoneyFormat";
import {
  formatPlanIntervalLabel,
  type PlanInterval,
} from "./usePlanIntervalLabel";

/**
 * A plan as the public registration screen sees it.
 */
export interface RegistrationPlan {
  _id: string;
  name: string;
  description: string;
  price: number;
  currency: string;
  interval: PlanInterval;
  trialDays: number;
  audience: string;
  borderColor: string | null;
  borderLabel: string | null;
  order: number;
}

export interface RegistrationForm {
  customerType: "individual" | "business";
  email: string;
  password: string;
  name: string;
  workspaceName: string;
  companyName: string;
  vatNumber: string;
  country: string;
  addressLine1: string;
  postalCode: string;
  city: string;
  selectedPlanId: string | null;
  hasAcceptedLegal: boolean;
}

/** Everything the submit guard looks at, independent of how it is bound. */
export interface RegistrationRequirements {
  selectedPlanId: string | null;
  isPaymentReady: boolean;
  hasAcceptedLegal: boolean;
  country: string;
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
   * Whatever the consuming SaaS captures on top of the billing fields, read
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

interface RegistrationAddress {
  country: string;
  line1?: string;
  postalCode?: string;
  city?: string;
}

interface RegistrationPayload {
  email: string;
  password: string;
  name: string;
  workspaceName: string;
  planId: string;
  customerType: string;
  companyName?: string;
  vatNumber?: string;
  paymentMethodId: string;
  address: RegistrationAddress;
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

interface DmsSaasPublicRuntimeConfig {
  stripePublishableKey?: string;
  admissionMode?: "open" | "invitation-only";
}

const PLANS_ENDPOINT = "/api/saas/plans/public";
const SETUP_INTENT_ENDPOINT = "/api/saas/register/setup-intent";
const REGISTER_ENDPOINT = "/api/saas/register";
const DEFAULT_PAYMENT_ELEMENT_ID = "dms-saas-register-payment-element";
const DEFAULT_REDIRECT = "/auth/login";
const ANY_AUDIENCE = "any";
const PLAN_PRICE_KEY = "saas.register.price";
const NO_PLAN_ERROR_KEY = "saas.register.error.no_plan";
const NO_PAYMENT_ERROR_KEY = "saas.register.error.no_payment";
const LOAD_ERROR_KEY = "saas.register.error.load";
const SUBMIT_ERROR_KEY = "saas.register.error.failed";

/**
 * Checked in the order the visitor can act on them, so a missing plan is never
 * reported as a payment failure.
 */
const REGISTRATION_REQUIREMENTS: RegistrationRequirement[] = [
  {
    errorKey: NO_PLAN_ERROR_KEY,
    isMet: (requirements) => Boolean(requirements.selectedPlanId),
  },
  {
    errorKey: NO_PAYMENT_ERROR_KEY,
    isMet: (requirements) => requirements.isPaymentReady,
  },
  {
    errorKey: "saas.register.error.legal_required",
    isMet: (requirements) => requirements.hasAcceptedLegal,
  },
  {
    errorKey: "saas.register.error.no_country",
    isMet: (requirements) => Boolean(requirements.country),
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

function planIntervalLabel(
  interval: PlanInterval,
  translate: RegistrationTranslator,
): string {
  return formatPlanIntervalLabel(interval, "saas.register.interval", translate);
}

/**
 * Price the way a summary line reads it: amount and cadence as one string, in
 * the visitor's locale, decimals dropped on whole amounts.
 *
 * Takes its locale and translator instead of reading them from the component
 * context, so a consumer can price a plan outside a `setup()` call.
 *
 * @param plan Plan to price
 * @param locale BCP 47 locale the amount is formatted in
 * @param translate Translation function for the price pattern and the cadence
 * @returns Localised price, e.g. `20 €/mois`
 */
export function formatRegistrationPlanPrice(
  plan: RegistrationPlan,
  locale: string,
  translate: RegistrationTranslator,
): string {
  const price = formatMajorUnits(plan.price, plan.currency, locale, {
    hideWholeAmountDecimals: true,
  });
  return translate(PLAN_PRICE_KEY, {
    price,
    interval: planIntervalLabel(plan.interval, translate),
  });
}

/**
 * The offer a customer type is entitled to, in the order it should read.
 *
 * Sorted here because the endpoint returns plans in storage order, and the
 * first plan on offer is the one that ends up pre-selected: it has to be the
 * one the operator ranked first, not the one created first.
 *
 * @param all Every publicly visible plan
 * @param customerType Customer type the visitor declared
 * @returns Plans that customer type may subscribe to
 */
export function resolveOfferedPlans(
  all: RegistrationPlan[],
  customerType: string,
): RegistrationPlan[] {
  return all
    .filter(
      (plan) => plan.audience === ANY_AUDIENCE || plan.audience === customerType,
    )
    .sort((left, right) => left.order - right.order);
}

/**
 * The plan selection to hold on to now that this is the offer.
 *
 * Switching customer type reshuffles the offer: a selection the visitor can no
 * longer subscribe to would travel to the API and come back rejected, so it
 * falls back to the first plan they may actually buy.
 *
 * @param available Plans the current customer type may subscribe to
 * @param current Plan id currently selected, if any
 * @returns Plan id to select, or null when nothing is on offer
 */
export function resolveSelectedPlanId(
  available: RegistrationPlan[],
  current: string | null,
): string | null {
  const isStillOffered = available.some((plan) => plan._id === current);
  return isStillOffered ? current : (available[0]?._id ?? null);
}

function optionalField(value: string): string | undefined {
  return value.trim() || undefined;
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
 * dms-saas owns what is dangerous to re-derive — the Stripe setup intent and
 * card confirmation, the order the fields are validated in, the shape of the
 * provisioning call, the mapping from API failures to a message — and hands
 * the consumer plain state to bind and one action to call. Each SaaS then
 * writes the markup its conversion funnel needs: the fields it groups, the way
 * it presents plans, whether it is one page or three steps, its own copy.
 *
 * The screen shipped in this package is one consumer among others: replace it
 * by turning it off (`publicScreens.register: false` in the module config) and
 * registering your own page on the `register` slug, then build the markup you
 * want on this composable rather than forking its logic.
 *
 * @param options Landing route and payment element id
 * @returns Bindable form state, plan data, submission action and status
 */
export function useSaasRegistration(options: UseSaasRegistrationOptions = {}) {
  const { $authFetch } = useAuthFetch();
  const { resolveApiError } = useApiErrorMessage();
  const { countryItems } = useBillingCountries();
  const { $i18n } = useDmsApp();
  const config = useDmsRuntimeConfig();

  const translate: RegistrationTranslator = (key, params) =>
    params ? $i18n.t(key, params) : $i18n.t(key);

  const paymentElementId =
    options.paymentElementId ?? DEFAULT_PAYMENT_ELEMENT_ID;
  const redirectTo = options.redirectTo ?? DEFAULT_REDIRECT;

  const form = reactive<RegistrationForm>({
    customerType: "individual",
    email: "",
    password: "",
    name: "",
    workspaceName: "",
    companyName: "",
    vatNumber: "",
    country: "",
    addressLine1: "",
    postalCode: "",
    city: "",
    selectedPlanId: null,
    hasAcceptedLegal: false,
  });

  const allPlans = ref<RegistrationPlan[]>([]);
  const isLoading = ref(true);
  const isSubmitting = ref(false);
  const errorMessage = ref<string | null>(null);
  const stripeHandle = ref<ReturnType<typeof useStripePaymentElement> | null>(
    null,
  );

  const stripePublishableKey = computed<string>(
    () =>
      (config.public.dmsSaas as DmsSaasPublicRuntimeConfig | undefined)
        ?.stripePublishableKey ?? "",
  );

  /** Plans the current customer type may subscribe to, in the operator's order. */
  const plans = computed(() =>
    resolveOfferedPlans(allPlans.value, form.customerType),
  );

  const selectedPlan = computed(
    () => plans.value.find((plan) => plan._id === form.selectedPlanId) ?? null,
  );

  /**
   * Whether the card field has been wired to Stripe — false as long as the
   * publishable key or the setup intent is missing.
   */
  const isPaymentReady = computed(() => stripeHandle.value !== null);

  const requirements = computed<RegistrationRequirements>(() => ({
    selectedPlanId: form.selectedPlanId,
    isPaymentReady: isPaymentReady.value,
    hasAcceptedLegal: form.hasAcceptedLegal,
    country: form.country,
  }));

  const missingRequirement = computed(() =>
    firstMissingRegistrationRequirement(requirements.value),
  );

  const canSubmit = computed(
    () => !isSubmitting.value && missingRequirement.value === null,
  );

  function formatPlanPrice(plan: RegistrationPlan): string {
    return formatRegistrationPlanPrice(plan, $i18n.locale.value, translate);
  }

  // Repaired synchronously, not on the next flush: a consumer that switches
  // customer type and submits in the same tick would otherwise send the plan
  // the visitor can no longer buy.
  watch(
    plans,
    (available) => {
      form.selectedPlanId = resolveSelectedPlanId(
        available,
        form.selectedPlanId,
      );
    },
    { flush: "sync" },
  );

  async function loadPlans(): Promise<void> {
    allPlans.value = await $authFetch<RegistrationPlan[]>(PLANS_ENDPOINT);
  }

  async function mountPaymentElement(): Promise<void> {
    if (!stripePublishableKey.value) return;
    const setup = await $authFetch<SetupIntentResponse>(SETUP_INTENT_ENDPOINT);
    if (!setup.clientSecret) return;
    stripeHandle.value = useStripePaymentElement({
      publishableKey: stripePublishableKey.value,
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
   * half read before and half after would pair, say, the plan chosen then with
   * the customer type chosen since — which the API rejects, once the card has
   * already been confirmed.
   */
  function captureSubmission(planId: string): RegistrationSubmission {
    const isBusiness = form.customerType === "business";
    return {
      email: form.email,
      password: form.password,
      name: form.name,
      workspaceName: form.workspaceName,
      planId,
      customerType: form.customerType,
      companyName: isBusiness ? form.companyName : undefined,
      vatNumber: isBusiness ? optionalField(form.vatNumber) : undefined,
      address: {
        country: form.country,
        line1: optionalField(form.addressLine1),
        postalCode: optionalField(form.postalCode),
        city: optionalField(form.city),
      },
      extras: snapshotRegistrationExtras(toValue(options.extras)),
    };
  }

  /**
   * Confirm the card, provision the workspace, land on the configured route.
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

    const planId = form.selectedPlanId;
    if (missingRequirement.value || !planId) {
      errorMessage.value = translate(
        missingRequirement.value ?? NO_PLAN_ERROR_KEY,
      );
      return null;
    }

    errorMessage.value = null;
    isSubmitting.value = true;
    let tenantId: string | null = null;
    try {
      // Inside the guard: freezing the capture reads the consumer's object,
      // and a consumer's object is never guaranteed to be serialisable.
      const submission = captureSubmission(planId);
      const paymentMethodId = await confirmPaymentMethod();
      if (!paymentMethodId) return null;

      const result = await $authFetch<RegistrationResult>(REGISTER_ENDPOINT, {
        method: "POST",
        body: { ...submission, paymentMethodId },
      });

      tenantId = result.tenantId ?? null;
      if (tenantId) await navigateDms(redirectTo);
      return tenantId;
    } catch (error) {
      // Once the workspace exists, whatever failed after it is a landing
      // problem: calling it a failed registration sends a visitor who has
      // already paid back through a flow that would charge them again.
      if (tenantId) return tenantId;
      errorMessage.value = resolveApiError(error, SUBMIT_ERROR_KEY);
      return null;
    } finally {
      isSubmitting.value = false;
    }
  }

  onMounted(async () => {
    if (
      (config.public.dmsSaas as DmsSaasPublicRuntimeConfig | undefined)
        ?.admissionMode === "invitation-only"
    ) {
      isLoading.value = false;
      return;
    }
    try {
      await Promise.all([loadPlans(), mountPaymentElement()]);
    } catch (error) {
      errorMessage.value = resolveApiError(error, LOAD_ERROR_KEY);
    } finally {
      isLoading.value = false;
    }
  });

  return {
    form,
    plans,
    selectedPlan,
    countryItems,
    paymentElementId,
    isPaymentReady,
    isLoading,
    isSubmitting,
    errorMessage,
    missingRequirement,
    canSubmit,
    formatPlanPrice,
    submit,
  };
}
