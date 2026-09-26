<script setup lang="ts">
import { computed, onMounted } from "vue";

const BILLING_PATH = "/settings/workspace/billing";
const KEY_PREFIX = "saas.workspace.seats";

const { data: quota, error, refresh } = useSeatQuota();
const { t } = useI18n();

const hasLimit = computed(() => (quota.value?.maxMembers ?? -1) >= 0);

const isFull = computed(
  () =>
    hasLimit.value &&
    (quota.value?.occupied ?? 0) >= (quota.value?.maxMembers ?? 0),
);

const usageLabel = computed(() => {
  const occupied = quota.value?.occupied ?? 0;
  if (!hasLimit.value) {
    return t(`${KEY_PREFIX}.badge_unlimited`, { occupied });
  }
  return `${occupied} / ${quota.value?.maxMembers}`;
});

const breakdown = computed(() =>
  t(`${KEY_PREFIX}.description`, {
    members: quota.value?.members ?? 0,
    invites: quota.value?.pendingInvites ?? 0,
  }),
);

const platformSupport = computed(() => quota.value?.platformSupport ?? []);

const limitMessage = computed(() =>
  quota.value?.isTenantOwner
    ? t(`${KEY_PREFIX}.limit_reached_owner`)
    : t(`${KEY_PREFIX}.limit_reached_member`),
);

// Refetch rather than serve the shared cache: adding a member or an invite
// lands back on this page, and a stale count would contradict the table right
// above the banner.
onMounted(refresh);
</script>

<template>
  <DmsSaasLoadFailure
    v-if="error && !quota"
    :title="$t(`${KEY_PREFIX}.load_failed`)"
    @retry="refresh"
  />
  <UCard
    v-else-if="quota"
    variant="subtle"
    :class="isFull ? 'ring-error/40' : undefined"
  >
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div class="flex flex-col gap-1">
        <div class="flex flex-wrap items-center gap-2">
          <UIcon name="i-ph-users-three" class="text-muted size-5" />
          <h3 class="font-semibold">{{ $t(`${KEY_PREFIX}.title`) }}</h3>
          <UBadge :color="isFull ? 'error' : 'neutral'" variant="subtle">
            {{ usageLabel }}
          </UBadge>
        </div>
        <p class="text-muted text-sm">{{ breakdown }}</p>
        <p v-if="isFull" class="text-sm">{{ limitMessage }}</p>
      </div>
      <UButton
        v-if="isFull && quota.isTenantOwner"
        color="primary"
        icon="i-ph-arrow-circle-up"
        :to="BILLING_PATH"
      >
        {{ $t(`${KEY_PREFIX}.upgrade`) }}
      </UButton>
    </div>
    <div
      v-if="platformSupport.length > 0"
      class="border-default mt-4 flex flex-col gap-2 border-t pt-4"
    >
      <div class="flex flex-col gap-1">
        <h4 class="text-sm font-semibold">
          {{ $t(`${KEY_PREFIX}.platform_support.title`) }}
        </h4>
        <p class="text-muted text-sm">
          {{ $t(`${KEY_PREFIX}.platform_support.description`) }}
        </p>
      </div>
      <ul class="flex flex-col gap-2">
        <li
          v-for="member in platformSupport"
          :key="member.userId"
          class="flex flex-wrap items-center gap-2 text-sm"
        >
          <span class="font-medium">{{ member.name }}</span>
          <span class="text-muted">{{ member.email }}</span>
          <UBadge color="info" variant="subtle" icon="i-ph-lifebuoy">
            {{ $t(`${KEY_PREFIX}.platform_support.badge`) }}
          </UBadge>
        </li>
      </ul>
    </div>
  </UCard>
</template>
