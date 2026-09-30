<script setup lang="ts">
import { computed, ref } from "vue";

const KEY_PREFIX = "saas.workspace.plan.checkout_pending";

const toast = useToast();
const { resolveApiError } = useApiErrorMessage();
const { prompt, resume, startOver } = usePendingCheckout();

const isRestarting = ref(false);

const open = computed({
  get: () => prompt.value !== null,
  set: (isOpen: boolean) => {
    if (!isOpen) prompt.value = null;
  },
});

const pending = computed(() => prompt.value?.pending ?? null);
const canResume = computed(() => !!pending.value?.checkoutUrl);

/** A paid checkout only waits for Stripe; one still opening only for time. */
const descriptionKey = computed(() => {
  if (pending.value?.isPaid) return `${KEY_PREFIX}.description_paid`;
  return canResume.value
    ? `${KEY_PREFIX}.description`
    : `${KEY_PREFIX}.description_opening`;
});

async function restart(): Promise<void> {
  isRestarting.value = true;
  try {
    await startOver();
  } catch (error) {
    toast.add({
      title: resolveApiError(error, `${KEY_PREFIX}.restart_error`),
      color: "error",
      icon: "i-ph-warning-circle",
    });
    isRestarting.value = false;
  }
}
</script>

<template>
  <UModal
    v-model:open="open"
    :title="$t(`${KEY_PREFIX}.title`)"
    :description="$t(descriptionKey)"
  >
    <template #footer>
      <div class="flex w-full flex-wrap justify-end gap-2">
        <UButton color="neutral" variant="subtle" @click="open = false">
          {{ $t(`${KEY_PREFIX}.close`) }}
        </UButton>
        <UButton
          v-if="canResume"
          color="neutral"
          variant="outline"
          icon="i-ph-arrow-counter-clockwise"
          :loading="isRestarting"
          @click="restart"
        >
          {{ $t(`${KEY_PREFIX}.restart`) }}
        </UButton>
        <UButton
          v-if="canResume"
          color="primary"
          icon="i-ph-lock-simple"
          :disabled="isRestarting"
          @click="resume"
        >
          {{ $t(`${KEY_PREFIX}.resume`) }}
        </UButton>
      </div>
    </template>
  </UModal>
</template>
