<script setup lang="ts">
/**
 * Reference implementation of the public registration flow.
 *
 * Deliberately plain: every SaaS wants its own funnel, so this screen exists
 * to work out of the box, not to be the design anyone ships. Replace it by
 * turning the bundled page off (`publicScreens.register: false` in the
 * dms-saas config) and registering your own page on the `register` slug, then
 * build the markup you want on `useSaasRegistration()`, which owns the card
 * policy, the Stripe orchestration, the validation order and the provisioning
 * call.
 */
const {
  form,
  paymentElementId,
  canSkipPaymentMethod,
  isPaymentStepVisible,
  isRegistrationClosed,
  errorMessage,
  isSubmitting,
  submit,
} = useSaasRegistration();
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
        <UFormField :label="$t('saas.register.field.full_name')">
          <UInput
            v-model="form.name"
            autocomplete="name"
            class="w-full"
            required
          />
        </UFormField>

        <UFormField :label="$t('saas.register.field.email')">
          <UInput
            v-model="form.email"
            type="email"
            autocomplete="email"
            class="w-full"
            required
          />
        </UFormField>

        <UFormField
          :label="$t('saas.register.field.password')"
          :hint="$t('saas.register.hint.password')"
        >
          <UInput
            v-model="form.password"
            type="password"
            autocomplete="new-password"
            class="w-full"
            required
          />
        </UFormField>

        <UCheckbox
          v-if="canSkipPaymentMethod"
          v-model="form.skipsPaymentMethod"
          :label="$t('saas.register.skip_payment_method')"
        />

        <!-- v-show keeps the Stripe element mounted while the step is hidden. -->
        <UFormField
          v-show="isPaymentStepVisible"
          :label="$t('saas.register.field.card')"
          :hint="$t('saas.register.hint.card')"
        >
          <div
            :id="paymentElementId"
            class="border-default rounded-md border p-4"
          />
        </UFormField>

        <UCheckbox v-model="form.hasAcceptedLegal" required>
          <template #label>
            <i18n-t keypath="saas.register.legal_acceptance" tag="span">
              <template #terms_and_conditions>
                <DmsLink
                  to="/terms-and-conditions"
                  target="_blank"
                  class="underline"
                >
                  {{ $t("saas.legal.terms_and_conditions") }}
                </DmsLink>
              </template>
              <template #privacy_policy>
                <DmsLink
                  to="/privacy-policy"
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
