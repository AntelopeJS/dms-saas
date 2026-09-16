<template>
  <div class="mx-auto w-full max-w-xl px-4 pb-16">
    <UCard>
      <template #header>
        <h2 class="text-xl font-semibold">
          {{ $t("saas.admission.title") }}
        </h2>
      </template>
      <p class="text-muted mb-6">{{ $t("saas.admission.description") }}</p>
      <UButton to="/auth/login" color="primary">
        {{ $t("saas.admission.login") }}
      </UButton>
    </UCard>
  </div>
</template>
