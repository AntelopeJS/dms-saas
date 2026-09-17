<script setup lang="ts">
import { computed, onMounted, ref } from "vue";

interface PlanOption {
  _id: string;
  name: string;
  description: string;
  price: number;
  currency: string;
  interval: string;
  trialDays: number;
  audience: string;
  borderColor: string | null;
  borderLabel: string | null;
}

interface OAuthProviderOption {
  id: string;
  label: string;
  icon: string;
}

interface DmsPublicRuntime {
  baseURL: string;
  oauthProviders?: OAuthProviderOption[];
}

interface DmsSaasPublicRuntimeConfig {
  stripePublishableKey?: string;
  admissionMode?: "open" | "invitation-only";
}

interface PendingRegistration {
  email: string;
  name: string;
  provider: string | null;
}

const PLANS_ENDPOINT = "/api/saas/plans/public";
const SETUP_INTENT_ENDPOINT = "/api/saas/register/setup-intent";
const PENDING_ENDPOINT = "/api/saas/register/pending";
const LOGIN_REDIRECT = "/auth/login";
const PAYMENT_ELEMENT_ID = "dms-saas-finalize-payment-element";
const HOME_REDIRECT = "/";
const FALLBACK_PROVIDER_ICON = "i-ph-shield-check";

const route = useDmsRoute();
const config = useDmsRuntimeConfig();
const nuxtApp = useDmsApp();
const dmsSaasRuntime = computed(
  () => config.public.dmsSaas as DmsSaasPublicRuntimeConfig | undefined,
);
const isRegistrationClosed = computed(
  () => dmsSaasRuntime.value?.admissionMode === "invitation-only",
);

const tenantAssignmentToken = computed<string>(() => {
  const value = route.query.token;
  return typeof value === "string" ? value : "";
});

const dmsRuntime = computed<DmsPublicRuntime>(
  () => config.public.dms as DmsPublicRuntime,
);

const stripePublishableKey = computed<string>(
  () => dmsSaasRuntime.value?.stripePublishableKey ?? "",
);

// Only `finalize` goes through the frontend server, and only because it opens
// the session cookie on the workspace it provisions; every other public
// registration endpoint is called on the DMS API directly.
const apiFetch = $fetch.create({ baseURL: dmsRuntime.value.baseURL });

const { countryItems } = useBillingCountries();

const customerType = ref<"individual" | "business">("individual");
const workspaceName = ref("");
const companyName = ref("");
const vatNumber = ref("");
const country = ref("");
const addressLine1 = ref("");
const postalCode = ref("");
const city = ref("");
const selectedPlanId = ref<string | null>(null);
const plans = ref<PlanOption[]>([]);
const isLoadingPlans = ref(false);
const isSubmitting = ref(false);
const errorMessage = ref<string | null>(null);
const { resolveApiError } = useApiErrorMessage();
const pendingRegistration = ref<PendingRegistration | null>(null);
const entryErrorMessage = ref<string | null>(null);
const hasAcceptedLegal = ref(false);
const stripeHandle = ref<ReturnType<typeof useStripePaymentElement> | null>(
  null,
);

const customerTypeItems = computed(() => [
  {
    value: "individual",
    label: nuxtApp.$i18n.t("saas.register.customer_type.individual"),
  },
  {
    value: "business",
    label: nuxtApp.$i18n.t("saas.register.customer_type.business"),
  },
]);

const filteredPlans = computed(() =>
  plans.value.filter(
    (plan) => plan.audience === "any" || plan.audience === customerType.value,
  ),
);

const tokenMissing = computed(() => tenantAssignmentToken.value.length === 0);

const entryProvider = computed<OAuthProviderOption | null>(() => {
  const providerId = pendingRegistration.value?.provider;
  if (!providerId) return null;
  const declared = dmsRuntime.value.oauthProviders ?? [];
  return (
    declared.find((provider) => provider.id === providerId) ?? {
      id: providerId,
      label: providerId,
      icon: FALLBACK_PROVIDER_ICON,
    }
  );
});

const entryDescription = computed<string>(() => {
  const email = pendingRegistration.value?.email ?? "";
  const provider = entryProvider.value;
  if (!provider) {
    return nuxtApp.$i18n.t("saas.oauth_registration.identity.password", {
      email,
    });
  }
  return nuxtApp.$i18n.t("saas.oauth_registration.identity.provider", {
    email,
    provider: provider.label,
  });
});

const submitDisabled = computed(
  () =>
    isSubmitting.value ||
    isLoadingPlans.value ||
    !selectedPlanId.value ||
    !workspaceName.value ||
    !country.value ||
    !hasAcceptedLegal.value,
);

const submitLabel = computed(() =>
  isSubmitting.value
    ? nuxtApp.$i18n.t("saas.no_workspace.submitting")
    : nuxtApp.$i18n.t("saas.no_workspace.submit"),
);

async function loadPendingRegistration(): Promise<void> {
  pendingRegistration.value = await apiFetch<PendingRegistration>(
    PENDING_ENDPOINT,
    {
      method: "POST",
      body: { tenant_assignment_token: tenantAssignmentToken.value },
    },
  );
}

async function loadPlans(): Promise<void> {
  isLoadingPlans.value = true;
  try {
    plans.value = await apiFetch<PlanOption[]>(PLANS_ENDPOINT);
  } finally {
    isLoadingPlans.value = false;
  }
}

async function initStripeElement(): Promise<void> {
  if (!stripePublishableKey.value) return;
  const setup = await apiFetch<{ clientSecret: string }>(SETUP_INTENT_ENDPOINT);
  stripeHandle.value = useStripePaymentElement({
    publishableKey: stripePublishableKey.value,
    clientSecret: setup.clientSecret,
    containerId: PAYMENT_ELEMENT_ID,
  });
}

function backToLogin(): void {
  if (typeof window !== "undefined") {
    window.location.href = LOGIN_REDIRECT;
  }
}

async function submit(): Promise<void> {
  if (tokenMissing.value) {
    errorMessage.value = nuxtApp.$i18n.t(
      "saas.no_workspace.error.missing_token",
    );
    return;
  }
  if (!selectedPlanId.value) {
    errorMessage.value = nuxtApp.$i18n.t("saas.register.error.no_plan");
    return;
  }
  if (!stripeHandle.value) {
    errorMessage.value = nuxtApp.$i18n.t("saas.register.error.no_payment");
    return;
  }
  if (!hasAcceptedLegal.value) {
    errorMessage.value = nuxtApp.$i18n.t("saas.register.error.legal_required");
    return;
  }
  if (!country.value) {
    errorMessage.value = nuxtApp.$i18n.t("saas.register.error.no_country");
    return;
  }
  errorMessage.value = null;
  isSubmitting.value = true;
  try {
    const confirm = await stripeHandle.value.confirmAndGetPaymentMethod();
    if (confirm.error || !confirm.paymentMethodId) {
      errorMessage.value =
        confirm.error?.message ??
        nuxtApp.$i18n.t("saas.register.error.no_payment");
      return;
    }
    await $fetch(SESSION_ESTABLISH_ENDPOINT, {
      method: "POST",
      body: buildSessionEstablishRequest({
        tenantAssignmentToken: tenantAssignmentToken.value,
        workspaceName: workspaceName.value,
        planId: selectedPlanId.value,
        customerType: customerType.value,
        companyName: companyName.value,
        vatNumber: vatNumber.value,
        address: {
          country: country.value,
          line1: addressLine1.value || undefined,
          postalCode: postalCode.value || undefined,
          city: city.value || undefined,
        },
        paymentMethodId: confirm.paymentMethodId,
      }),
    });
    if (typeof window !== "undefined") {
      window.location.href = HOME_REDIRECT;
    }
  } catch (error) {
    errorMessage.value = resolveApiError(error, "saas.register.error.failed");
  } finally {
    isSubmitting.value = false;
  }
}

onMounted(async () => {
  if (tokenMissing.value || isRegistrationClosed.value) return;
  // The identity is resolved before anything is asked of the user: an expired
  // token or an account that already owns a workspace must fail here, not
  // after a card has been entered.
  try {
    await loadPendingRegistration();
  } catch (error) {
    entryErrorMessage.value = resolveApiError(
      error,
      "saas.oauth_registration.error.entry_failed",
    );
    return;
  }
  try {
    await loadPlans();
    await initStripeElement();
  } catch (error) {
    errorMessage.value = resolveApiError(error, "saas.register.error.failed");
  }
});
</script>

<template>
  <DmsSaasRegistrationClosed v-if="isRegistrationClosed" />
  <div v-else class="mx-auto max-w-4xl px-4 py-10">
    <header class="mb-8 flex items-start justify-between gap-4">
      <div>
        <h1 class="text-2xl font-semibold sm:text-3xl">
          {{ $t("saas.no_workspace.title") }}
        </h1>
        <p class="text-muted mt-2 max-w-2xl">
          {{ $t("saas.no_workspace.subtitle") }}
        </p>
      </div>
      <UButton
        variant="ghost"
        color="neutral"
        icon="i-ph-sign-out"
        size="sm"
        @click="backToLogin"
      >
        {{ $t("saas.no_workspace.logout") }}
      </UButton>
    </header>

    <UAlert
      v-if="tokenMissing"
      class="mt-2"
      color="error"
      variant="subtle"
      icon="i-ph-warning-circle"
      :title="$t('saas.no_workspace.error.missing_token')"
      :description="$t('saas.no_workspace.error.relogin')"
    >
      <template #actions>
        <UButton color="error" variant="solid" @click="backToLogin">
          {{ $t("saas.no_workspace.logout") }}
        </UButton>
      </template>
    </UAlert>

    <UAlert
      v-else-if="entryErrorMessage"
      class="mt-2"
      color="error"
      variant="subtle"
      icon="i-ph-warning-circle"
      :title="entryErrorMessage"
      :description="$t('saas.no_workspace.error.relogin')"
    >
      <template #actions>
        <UButton color="error" variant="solid" @click="backToLogin">
          {{ $t("saas.oauth_registration.error.entry_action") }}
        </UButton>
      </template>
    </UAlert>

    <form v-else class="flex flex-col gap-6" @submit.prevent="submit">
      <UAlert
        v-if="pendingRegistration"
        color="neutral"
        variant="subtle"
        :icon="entryProvider?.icon ?? 'i-ph-user-circle'"
        :title="entryDescription"
        :description="$t('saas.oauth_registration.identity.hint')"
      />

      <UCard>
        <template #header>
          <div>
            <h2 class="text-lg font-semibold">
              {{ $t("saas.no_workspace.section.details") }}
            </h2>
            <p class="text-muted mt-1 text-sm">
              {{ $t("saas.no_workspace.section.details_hint") }}
            </p>
          </div>
        </template>
        <div class="flex flex-col gap-4">
          <URadioGroup
            v-model="customerType"
            orientation="horizontal"
            :items="customerTypeItems"
          />
          <UFormField :label="$t('saas.register.field.workspace_name')">
            <UInput
              v-model="workspaceName"
              icon="i-ph-buildings"
              required
              class="w-full"
            />
          </UFormField>
          <template v-if="customerType === 'business'">
            <UFormField :label="$t('saas.register.field.company_name')">
              <UInput v-model="companyName" required class="w-full" />
            </UFormField>
            <UFormField :label="$t('saas.register.field.vat_number')">
              <UInput v-model="vatNumber" class="w-full" />
            </UFormField>
          </template>
          <h3 class="font-semibold">
            {{ $t("saas.register.billing_address") }}
          </h3>
          <UFormField :label="$t('saas.register.field.country')">
            <USelect v-model="country" :items="countryItems" class="w-full" />
          </UFormField>
          <UFormField :label="$t('saas.register.field.address_line1')">
            <UInput v-model="addressLine1" class="w-full" />
          </UFormField>
          <div class="grid grid-cols-2 gap-4">
            <UFormField :label="$t('saas.register.field.postal_code')">
              <UInput v-model="postalCode" class="w-full" />
            </UFormField>
            <UFormField :label="$t('saas.register.field.city')">
              <UInput v-model="city" class="w-full" />
            </UFormField>
          </div>
        </div>
      </UCard>

      <UCard>
        <template #header>
          <div>
            <h2 class="text-lg font-semibold">
              {{ $t("saas.no_workspace.section.plan") }}
            </h2>
            <p class="text-muted mt-1 text-sm">
              {{ $t("saas.no_workspace.section.plan_hint") }}
            </p>
          </div>
        </template>
        <div
          v-if="isLoadingPlans"
          class="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-4"
        >
          <USkeleton v-for="i in 3" :key="i" class="h-40 rounded-lg" />
        </div>
        <div
          v-else
          class="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-4"
        >
          <DmsSaasPlanCardPublic
            v-for="plan in filteredPlans"
            :key="plan._id"
            :plan="plan"
            :selected="selectedPlanId === plan._id"
            @select="selectedPlanId = $event"
          />
        </div>
      </UCard>

      <UCard>
        <template #header>
          <div>
            <h2 class="text-lg font-semibold">
              {{ $t("saas.no_workspace.section.payment") }}
            </h2>
            <p class="text-muted mt-1 text-sm">
              {{ $t("saas.no_workspace.section.payment_hint") }}
            </p>
          </div>
        </template>
        <div
          :id="PAYMENT_ELEMENT_ID"
          class="border-default bg-default rounded-md border p-4"
        />
      </UCard>

      <div class="flex flex-col gap-4">
        <UCheckbox v-model="hasAcceptedLegal" required>
          <template #label>
            <i18n-t keypath="saas.register.legal_acceptance" tag="span">
              <template #terms_and_conditions>
                <DmsLink
                  to="/legal/terms-and-conditions"
                  target="_blank"
                  class="text-primary underline"
                >
                  {{ $t("saas.legal.terms_and_conditions") }}
                </DmsLink>
              </template>
              <template #privacy_policy>
                <DmsLink
                  to="/legal/privacy-policy"
                  target="_blank"
                  class="text-primary underline"
                >
                  {{ $t("saas.legal.privacy_policy") }}
                </DmsLink>
              </template>
            </i18n-t>
          </template>
        </UCheckbox>

        <UAlert
          v-if="errorMessage"
          color="error"
          variant="subtle"
          icon="i-ph-warning-circle"
          :description="errorMessage"
        />

        <UButton
          type="submit"
          :loading="isSubmitting"
          :disabled="submitDisabled"
          color="primary"
          size="lg"
          icon="i-ph-rocket-launch"
          block
        >
          {{ submitLabel }}
        </UButton>
      </div>
    </form>
  </div>
</template>
