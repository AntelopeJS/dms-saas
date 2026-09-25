<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";

interface WorkspaceSummaryData {
  _id: string;
  name: string;
  status: string | null;
  planName: string | null;
  currency: string;
  mrr: number;
  membersCount: number;
  pendingInvitationsCount: number;
  createdAt: string;
  subscription: { stripeCustomerId: string | null } | null;
}

type BadgeColor =
  | "primary"
  | "secondary"
  | "success"
  | "info"
  | "warning"
  | "error"
  | "neutral";

const STATUS_COLOR: Record<string, BadgeColor> = {
  active: "success",
  trialing: "info",
  past_due: "warning",
  suspended: "error",
  cancelled: "error",
};

const props = defineProps<{
  routeParams?: Record<string, string>;
}>();

const PEOPLE_SEPARATOR = " · ";

const { $authFetch } = useAuthFetch();
const { t } = useI18n();

const tenantId = computed(() => props.routeParams?.id ?? "");
const { triggerRef } = useDetailRefresh(tenantId.value);
const workspace = ref<WorkspaceSummaryData | null>(null);
const isLoading = ref(true);

const statusColor = computed(
  () => STATUS_COLOR[workspace.value?.status ?? ""] ?? "neutral",
);

const formattedMrr = computed(() => {
  if (!workspace.value) return "";
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: workspace.value.currency || "EUR",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(workspace.value.mrr);
});

/** Members, then the invitations still pending, if any. */
const peopleLabel = computed(() => {
  if (!workspace.value) return "";
  const { membersCount, pendingInvitationsCount } = workspace.value;
  const parts = [
    t("saas.workspaces.summary.members", { count: membersCount }, membersCount),
  ];
  if (pendingInvitationsCount > 0) {
    parts.push(
      t(
        "saas.workspaces.summary.pending_invitations",
        { count: pendingInvitationsCount },
        pendingInvitationsCount,
      ),
    );
  }
  return parts.join(PEOPLE_SEPARATOR);
});

function formatDate(value: string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

async function load(): Promise<void> {
  if (!tenantId.value) return;
  isLoading.value = true;
  try {
    workspace.value = await $authFetch<WorkspaceSummaryData>(
      `/api/saas/workspaces/${tenantId.value}`,
    );
  } finally {
    isLoading.value = false;
  }
}

onMounted(load);
watch(triggerRef, () => {
  void load();
});
</script>

<template>
  <DmsCard>
    <div v-if="isLoading" class="flex justify-center py-6">
      <UIcon name="i-ph-spinner" class="animate-spin text-2xl" />
    </div>
    <div v-else-if="workspace" class="flex flex-col gap-5">
      <div class="flex items-start gap-4">
        <div
          class="flex size-16 items-center justify-center rounded-lg bg-primary/15 text-primary"
        >
          <UIcon name="i-ph-building" class="text-3xl" />
        </div>
        <div class="flex-1 min-w-0">
          <div class="flex flex-wrap items-center gap-2">
            <h2 class="text-xl font-semibold truncate">
              {{ workspace.name }}
            </h2>
            <UBadge
              v-if="workspace.status"
              :color="statusColor"
              variant="subtle"
            >
              {{ $t(`saas.workspaces.status.${workspace.status}`) }}
            </UBadge>
          </div>
          <div class="mt-2 flex flex-col gap-1 text-sm text-muted">
            <div class="flex items-center gap-2">
              <UIcon name="i-ph-users" />
              <span>{{ peopleLabel }}</span>
            </div>
          </div>
        </div>
        <div class="text-right shrink-0">
          <UBadge
            v-if="workspace.planName"
            color="primary"
            variant="soft"
            class="text-base"
          >
            {{ workspace.planName }}
          </UBadge>
          <p class="mt-2 text-2xl font-bold">
            {{ formattedMrr }}
            <span class="text-sm font-normal text-muted">
              {{ $t("saas.workspaces.summary.per_month") }}
            </span>
          </p>
        </div>
      </div>

      <USeparator />

      <dl class="grid grid-cols-2 gap-3 text-sm lg:grid-cols-4">
        <div>
          <dt class="text-muted">
            {{ $t("saas.workspaces.column.created_at") }}
          </dt>
          <dd class="mt-0.5">{{ formatDate(workspace.createdAt) }}</dd>
        </div>
        <div>
          <dt class="text-muted">
            {{ $t("saas.workspaces.column.stripe_customer") }}
          </dt>
          <dd class="mt-0.5 truncate">
            {{ workspace.subscription?.stripeCustomerId ?? "—" }}
          </dd>
        </div>
      </dl>
    </div>
  </DmsCard>
</template>
