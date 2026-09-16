<script setup lang="ts">
/**
 * Reference implementation of the public registration flow.
 *
 * Deliberately plain: every SaaS wants its own funnel — its arguments, its way
 * of presenting plans, one page or three steps — so this screen exists to work
 * out of the box, not to be the design anyone ships. Replace it by turning the
 * bundled page off (`publicScreens.register: false` in the dms-saas config) and
 * registering your own page on the `register` slug, then build the markup you
 * want on `useSaasRegistration()`, which owns the Stripe orchestration, the
 * validation order and the provisioning call.
 */
interface DmsSaasPublicRuntimeConfig {
  admissionMode?: "open" | "invitation-only";
}

const {
  form,
  plans,
  countryItems,
  paymentElementId,
  errorMessage,
  isSubmitting,
  formatPlanPrice,
  submit,
} = useSaasRegistration();

const customerTypeItems = [
  { value: "individual", label: "saas.register.customer_type.individual" },
  { value: "business", label: "saas.register.customer_type.business" },
];
const config = useDmsRuntimeConfig();
const isRegistrationClosed =
  (config.public.dmsSaas as DmsSaasPublicRuntimeConfig | undefined)
    ?.admissionMode === "invitation-only";
</script>

<template>
  <DmsSaasRegistrationClosed v-if="isRegistrationClosed" />
  <div v-else class="mx-auto w-full max-w-xl px-4 pb-16">
    <UCard>
      <template #header>
        <h2 class="text-xl font-semibold">{{ $t("saas.register.title") }}</h2>
      </template>

      <DmsOAuthButtons :note="$t('saas.oauth_registration.entry_note')" />

      <form class="flex flex-col gap-4" @submit.prevent="submit">
        <URadioGroup
          v-model="form.customerType"
          :items="
            customerTypeItems.map((item) => ({
              value: item.value,
              label: $t(item.label),
            }))
          "
        />

        <UFormField :label="$t('saas.register.field.email')">
          <UInput v-model="form.email" type="email" class="w-full" required />
        </UFormField>

        <UFormField :label="$t('saas.register.field.password')">
          <UInput
            v-model="form.password"
            type="password"
            class="w-full"
            required
          />
        </UFormField>

        <UFormField :label="$t('saas.register.field.full_name')">
          <UInput v-model="form.name" class="w-full" required />
        </UFormField>

        <UFormField :label="$t('saas.register.field.workspace_name')">
          <UInput v-model="form.workspaceName" class="w-full" required />
        </UFormField>

        <template v-if="form.customerType === 'business'">
          <UFormField :label="$t('saas.register.field.company_name')">
            <UInput v-model="form.companyName" class="w-full" required />
          </UFormField>
          <UFormField :label="$t('saas.register.field.vat_number')">
            <UInput v-model="form.vatNumber" class="w-full" />
          </UFormField>
        </template>

        <h3 class="font-semibold">{{ $t("saas.register.billing_address") }}</h3>

        <UFormField :label="$t('saas.register.field.country')">
          <USelect
            v-model="form.country"
            :items="countryItems"
            class="w-full"
            required
          />
        </UFormField>

        <UFormField :label="$t('saas.register.field.address_line1')">
          <UInput v-model="form.addressLine1" class="w-full" />
        </UFormField>

        <div class="grid grid-cols-2 gap-4">
          <UFormField :label="$t('saas.register.field.postal_code')">
            <UInput v-model="form.postalCode" class="w-full" />
          </UFormField>
          <UFormField :label="$t('saas.register.field.city')">
            <UInput v-model="form.city" class="w-full" />
          </UFormField>
        </div>

        <h3 class="font-semibold">{{ $t("saas.register.choose_plan") }}</h3>

        <div class="flex flex-col gap-2">
          <button
            v-for="plan in plans"
            :key="plan._id"
            type="button"
            class="border-default rounded-md border p-3 text-left"
            :class="form.selectedPlanId === plan._id ? 'border-primary' : ''"
            @click="form.selectedPlanId = plan._id"
          >
            <div class="flex items-baseline justify-between gap-2">
              <span class="font-medium">{{ plan.name }}</span>
              <span class="tabular-nums">{{ formatPlanPrice(plan) }}</span>
            </div>
            <p class="text-muted text-sm">{{ plan.description }}</p>
          </button>
        </div>

        <UFormField :label="$t('saas.register.field.card')">
          <div :id="paymentElementId" class="border-default rounded-md border p-4" />
        </UFormField>

        <UCheckbox v-model="form.hasAcceptedLegal" required>
          <template #label>
            <i18n-t keypath="saas.register.legal_acceptance" tag="span">
              <template #terms_and_conditions>
                <DmsLink
                  to="/legal/terms-and-conditions"
                  target="_blank"
                  class="underline"
                >
                  {{ $t("saas.legal.terms_and_conditions") }}
                </DmsLink>
              </template>
              <template #privacy_policy>
                <DmsLink
                  to="/legal/privacy-policy"
                  target="_blank"
                  class="underline"
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
          :description="errorMessage"
        />

        <UButton type="submit" :loading="isSubmitting" color="primary" block>
          {{ $t("saas.register.submit") }}
        </UButton>
      </form>
    </UCard>
  </div>
</template>
