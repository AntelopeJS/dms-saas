<script setup lang="ts">
import { computed, onMounted, ref } from "vue";

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
  registrationPaymentMethod?: "required" | "optional" | "none";
}

interface PendingRegistration {
  email: string;
  name: string;
  provider: string | null;
}

const SETUP_INTENT_ENDPOINT = "/api/saas/register/setup-intent";
const PENDING_ENDPOINT = "/api/saas/register/pending";
const LOGIN_REDIRECT = "/auth/login";
const PAYMENT_ELEMENT_ID = "dms-saas-finalize-payment-element";
const HOME_REDIRECT = "/";
const FALLBACK_PROVIDER_ICON = "i-ph-shield-check";
const DEFAULT_WORKSPACE_NAME_KEY = "saas.register.default_workspace_name";

const route = useDmsRoute();
const config = useDmsRuntimeConfig();
const nuxtApp = useDmsApp();
const dmsSaasRuntime = config.public.dmsSaas as
  | DmsSaasPublicRuntimeConfig
  | undefined;
const isRegistrationClosed = isRegistrationClosedBy(dmsSaasRuntime);
const paymentMethodPolicy = resolveRegistrationPaymentPolicy(dmsSaasRuntime);
const canSkipPaymentMethod = paymentMethodPolicy === "optional";

const tenantAssignmentToken = computed<string>(() => {
  const value = route.query.token;
  return typeof value === "string" ? value : "";
});

const dmsRuntime = computed<DmsPublicRuntime>(
  () => config.public.dms as DmsPublicRuntime,
);

// Only `finalize` goes through the frontend server, and only because it opens
// the session cookie on the workspace it provisions; every other public
// registration endpoint is called on the DMS API directly.
const apiFetch = $fetch.create({ baseURL: dmsRuntime.value.baseURL });

const isSubmitting = ref(false);
const errorMessage = ref<string | null>(null);
const { resolveApiError } = useApiErrorMessage();
const pendingRegistration = ref<PendingRegistration | null>(null);
const entryErrorMessage = ref<string | null>(null);
const hasAcceptedLegal = ref(false);
const skipsPaymentMethod = ref(false);
const stripeHandle = ref<ReturnType<typeof useStripePaymentElement> | null>(
  null,
);

const isPaymentStepVisible = computed(() =>
  isPaymentStepShown(paymentMethodPolicy, skipsPaymentMethod.value),
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

const missingRequirement = computed(() =>
  firstMissingRegistrationRequirement({
    isPaymentRequired: isPaymentStepVisible.value,
    isPaymentReady: stripeHandle.value !== null,
    hasAcceptedLegal: hasAcceptedLegal.value,
  }),
);

const submitDisabled = computed(
  () => isSubmitting.value || !hasAcceptedLegal.value,
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

async function initStripeElement(): Promise<void> {
  const publishableKey = dmsSaasRuntime?.stripePublishableKey;
  if (!publishableKey || paymentMethodPolicy === "none") return;
  const setup = await apiFetch<{ clientSecret: string }>(SETUP_INTENT_ENDPOINT);
  stripeHandle.value = useStripePaymentElement({
    publishableKey,
    clientSecret: setup.clientSecret,
    containerId: PAYMENT_ELEMENT_ID,
  });
}

function backToLogin(): void {
  if (typeof window !== "undefined") {
    window.location.href = LOGIN_REDIRECT;
  }
}

/** The confirmed card, undefined when none is collected, null on failure. */
async function confirmPaymentMethod(): Promise<string | undefined | null> {
  if (!isPaymentStepVisible.value) return undefined;
  const confirm = await stripeHandle.value?.confirmAndGetPaymentMethod();
  if (confirm?.paymentMethodId) return confirm.paymentMethodId;
  errorMessage.value =
    confirm?.error?.message ??
    nuxtApp.$i18n.t("saas.register.error.no_payment");
  return null;
}

async function submit(): Promise<void> {
  if (tokenMissing.value) {
    errorMessage.value = nuxtApp.$i18n.t(
      "saas.no_workspace.error.missing_token",
    );
    return;
  }
  if (missingRequirement.value) {
    errorMessage.value = nuxtApp.$i18n.t(missingRequirement.value);
    return;
  }
  errorMessage.value = null;
  isSubmitting.value = true;
  try {
    const paymentMethodId = await confirmPaymentMethod();
    if (paymentMethodId === null) return;
    await $fetch(SESSION_ESTABLISH_ENDPOINT, {
      method: "POST",
      body: buildSessionEstablishRequest({
        tenantAssignmentToken: tenantAssignmentToken.value,
        workspaceName: nuxtApp.$i18n.t(DEFAULT_WORKSPACE_NAME_KEY, {
          name: pendingRegistration.value?.name ?? "",
        }),
        paymentMethodId,
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
  if (tokenMissing.value || isRegistrationClosed) return;
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

      <UCheckbox
        v-if="canSkipPaymentMethod"
        v-model="skipsPaymentMethod"
        :label="$t('saas.register.skip_payment_method')"
      />

      <!-- v-show keeps the Stripe element mounted while the step is hidden. -->
      <UCard v-show="isPaymentStepVisible">
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
                  to="/terms-and-conditions"
                  target="_blank"
                  class="text-primary underline"
                >
                  {{ $t("saas.legal.terms_and_conditions") }}
                </DmsLink>
              </template>
              <template #privacy_policy>
                <DmsLink
                  to="/privacy-policy"
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
