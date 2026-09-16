<script setup lang="ts">
import { computed, onMounted, ref } from "vue";

interface MatchedSegment {
  _id: string;
  name: string;
}

interface UserSummaryData {
  _id: string;
  email: string;
  name: string;
  owner: boolean;
  createdAt: string;
  language: string | null;
  isValidated: boolean;
  hasTwoFactor: boolean;
  lastActiveAt: string | null;
  segments: MatchedSegment[];
  workspaces: Array<{ isTenantOwner: boolean }>;
}

const props = defineProps<{
  routeParams?: Record<string, string>;
}>();

const { $authFetch } = useAuthFetch();
const { t } = useI18n();

const userId = computed(() => props.routeParams?.id ?? "");
const user = ref<UserSummaryData | null>(null);
const isLoading = ref(true);

const initials = computed(() => {
  if (!user.value?.name) return "?";
  return user.value.name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
});

const ownedCount = computed(
  () => user.value?.workspaces.filter((w) => w.isTenantOwner).length ?? 0,
);
const memberCount = computed(
  () => user.value?.workspaces.filter((w) => !w.isTenantOwner).length ?? 0,
);

function formatDate(value: string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

async function load(): Promise<void> {
  if (!userId.value) return;
  isLoading.value = true;
  try {
    user.value = await $authFetch<UserSummaryData>(
      `/api/saas/users/${userId.value}`,
    );
  } finally {
    isLoading.value = false;
  }
}

onMounted(load);
</script>

<template>
  <DmsCard>
    <div v-if="isLoading" class="flex justify-center py-6">
      <UIcon name="i-ph-spinner" class="animate-spin text-2xl" />
    </div>
    <div v-else-if="user" class="flex flex-col gap-5">
      <div class="flex items-start gap-4">
        <UAvatar
          :alt="user.name"
          :text="initials"
          size="xl"
          class="bg-primary/15 text-primary"
        />
        <div class="flex-1 min-w-0">
          <div class="flex flex-wrap items-center gap-2">
            <h2 class="text-xl font-semibold truncate">{{ user.name }}</h2>
            <UBadge v-if="user.owner" color="primary" variant="subtle">
              {{ $t("saas.users.platform_owner_badge") }}
            </UBadge>
            <UBadge
              :color="user.isValidated ? 'success' : 'warning'"
              variant="subtle"
            >
              {{
                user.isValidated
                  ? $t("saas.users.info.email_verified")
                  : $t("saas.users.info.email_not_verified")
              }}
            </UBadge>
          </div>
          <div class="mt-1 flex items-center gap-2 text-sm text-muted">
            <UIcon name="i-ph-envelope" />
            <span class="truncate">{{ user.email }}</span>
          </div>
        </div>
      </div>

      <USeparator />

      <dl class="grid grid-cols-2 gap-3 text-sm lg:grid-cols-4">
        <div>
          <dt class="text-muted">{{ $t("saas.users.column.created_at") }}</dt>
          <dd class="mt-0.5">{{ formatDate(user.createdAt) }}</dd>
        </div>
        <div>
          <dt class="text-muted">{{ $t("saas.users.info.last_active") }}</dt>
          <dd class="mt-0.5">{{ formatDate(user.lastActiveAt) }}</dd>
        </div>
        <div>
          <dt class="text-muted">{{ $t("saas.users.info.language") }}</dt>
          <dd class="mt-0.5 uppercase">{{ user.language ?? "—" }}</dd>
        </div>
        <div>
          <dt class="text-muted">{{ $t("saas.users.info.two_factor") }}</dt>
          <dd class="mt-0.5">
            {{ user.hasTwoFactor ? t("saas.common.yes") : t("saas.common.no") }}
          </dd>
        </div>
        <div>
          <dt class="text-muted">
            {{ $t("saas.users.workspaces_section") }}
          </dt>
          <dd class="mt-0.5">
            {{
              $t("saas.users.summary.workspaces", {
                count: user.workspaces.length,
                owned: ownedCount,
                member: memberCount,
              })
            }}
          </dd>
        </div>
        <div class="col-span-2 lg:col-span-3">
          <dt class="text-muted">{{ $t("saas.users.info.segments") }}</dt>
          <dd class="mt-0.5">
            <div v-if="user.segments.length" class="flex flex-wrap gap-1">
              <UBadge
                v-for="segment in user.segments"
                :key="segment._id"
                color="neutral"
                variant="soft"
              >
                {{ segment.name }}
              </UBadge>
            </div>
            <span v-else>—</span>
          </dd>
        </div>
      </dl>
    </div>
  </DmsCard>
</template>
