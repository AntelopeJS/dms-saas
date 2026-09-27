<script setup lang="ts">
import { computed, ref } from "vue";

const { $authFetch } = useAuthFetch();
const { t } = useI18n();
const planIntervalLabel = usePlanIntervalLabel("saas.plans.cycle");

interface PlanProp {
  _id: string;
  name: string;
  description: string;
  price: number;
  currency: string;
  interval: "month" | "year";
  audience: string;
  isActive: boolean;
  borderColor: string | null;
  borderLabel: string | null;
  trialDays: number;
  maxMembers: number;
  workspaceCount: number;
  features?: { featureId: string; value: unknown }[];
}

interface FeatureMeta {
  displayName: string;
  valueType: string;
}

const FEATURE_PREVIEW_LIMIT = 6;

const props = defineProps<{
  plan: PlanProp;
  featureMeta?: Record<string, FeatureMeta>;
}>();
const emit = defineEmits<{ changed: [] }>();

const showDeleteModal = ref(false);
const showConfirmDeactivateModal = ref(false);
const busy = ref(false);

const highlighted = computed(() => !!props.plan.borderLabel);
const accent = computed(() => props.plan.borderColor || "var(--ui-primary)");

const cardStyle = computed(() =>
  highlighted.value ? { boxShadow: `0 0 0 2px ${accent.value}` } : undefined,
);

const formattedPrice = computed(() =>
  new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: props.plan.currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(props.plan.price),
);

const cycle = computed(() => planIntervalLabel(props.plan.interval));

const membersLabel = computed(() =>
  props.plan.maxMembers < 0
    ? t("saas.plans.card.members_unlimited")
    : t("saas.plans.card.members", { count: props.plan.maxMembers }),
);

function isFeatureEnabled(value: unknown, valueType: string): boolean {
  if (valueType === "number") {
    return typeof value === "number" && value >= 0;
  }
  return value === true;
}

const features = computed(() =>
  (props.plan.features ?? [])
    .map((f) => {
      const meta = props.featureMeta?.[f.featureId];
      const valueType = meta?.valueType ?? "boolean";
      return {
        label: meta?.displayName ?? f.featureId,
        valueType,
        value: f.value,
        enabled: isFeatureEnabled(f.value, valueType),
      };
    })
    .sort((a, b) => Number(b.enabled) - Number(a.enabled))
    .slice(0, FEATURE_PREVIEW_LIMIT),
);

const editLink = computed(
  () => `/modules/saas/catalog/plans/${props.plan._id}/edit`,
);

async function applyActive(value: boolean): Promise<void> {
  busy.value = true;
  try {
    await $authFetch(`/api/saas/plans/${props.plan._id}`, {
      method: "PUT",
      body: { isActive: value },
    });
    emit("changed");
  } finally {
    busy.value = false;
  }
}

async function toggleActive(value: boolean): Promise<void> {
  if (busy.value) return;
  // Confirm grandfathering before deactivating. workspaceCount counts
  // subscriptions in any status, so this also triggers for plans whose only
  // subscriptions are cancelled or suspended.
  if (!value && props.plan.workspaceCount > 0) {
    showConfirmDeactivateModal.value = true;
    return;
  }
  await applyActive(value);
}

async function confirmDeactivate(): Promise<void> {
  showConfirmDeactivateModal.value = false;
  await applyActive(false);
}

function onDeleted(): void {
  showDeleteModal.value = false;
  emit("changed");
}
</script>

<template>
  <div class="relative h-full">
    <div
      v-if="plan.borderLabel"
      class="absolute -top-3 left-1/2 -translate-x-1/2 z-10"
    >
      <span
        class="inline-flex items-center gap-1 rounded-full px-3 py-0.5 text-xs font-semibold text-white shadow"
        :style="{ backgroundColor: accent }"
      >
        <UIcon name="i-ph-star-fill" class="size-3" />
        {{ plan.borderLabel }}
      </span>
    </div>

    <UCard
      class="h-full"
      :class="{ 'opacity-60': !plan.isActive }"
      :style="cardStyle"
    >
      <template #header>
        <div class="flex flex-col gap-2">
          <div class="flex items-center justify-between gap-2">
            <h3 class="text-lg font-semibold truncate">{{ plan.name }}</h3>
            <USwitch
              :model-value="plan.isActive"
              :disabled="busy"
              @update:model-value="toggleActive"
            />
          </div>
          <p v-if="plan.description" class="text-sm text-muted line-clamp-2">
            {{ plan.description }}
          </p>
        </div>
      </template>

      <div class="flex flex-col gap-4">
        <div>
          <div class="flex items-baseline gap-1">
            <span class="text-3xl font-bold tabular-nums">
              {{ formattedPrice }}
            </span>
            <span v-if="cycle" class="text-muted">/{{ cycle }}</span>
          </div>
          <p v-if="plan.trialDays > 0" class="text-xs text-muted mt-1">
            {{ $t("saas.plans.trial_days", { days: plan.trialDays }) }}
          </p>
        </div>

        <div class="flex items-center gap-2 text-sm text-muted">
          <UIcon name="i-ph-stack" class="size-4" />
          <span>
            {{
              $t("saas.plans.card.subscriptions", {
                count: plan.workspaceCount,
              })
            }}
          </span>
        </div>

        <div class="flex items-center gap-2 text-sm text-muted">
          <UIcon name="i-ph-users" class="size-4" />
          <span>{{ membersLabel }}</span>
        </div>

        <div
          v-if="features.length"
          class="flex flex-col gap-2 border-t border-default pt-4"
        >
          <p class="text-xs font-medium text-muted uppercase tracking-wide">
            {{ $t("saas.plans.field.features") }}
          </p>
          <div class="flex flex-col gap-1.5">
            <div
              v-for="feature in features"
              :key="feature.label"
              class="flex items-center gap-2 text-sm"
            >
              <UIcon
                :name="feature.enabled ? 'i-ph-check' : 'i-ph-x'"
                class="size-4 shrink-0"
                :class="
                  feature.enabled ? 'text-success' : 'text-muted opacity-50'
                "
              />
              <span
                class="truncate"
                :class="{ 'text-muted opacity-50': !feature.enabled }"
              >
                {{ feature.label }}
              </span>
              <span
                v-if="feature.valueType === 'number' && feature.enabled"
                class="text-muted text-xs tabular-nums ml-auto"
              >
                {{ feature.value }}
              </span>
            </div>
          </div>
        </div>
      </div>

      <template #footer>
        <div class="flex gap-2">
          <UButton
            class="flex-1 justify-center"
            variant="soft"
            icon="i-ph-pencil"
            :to="editLink"
          >
            {{ $t("saas.plans.action.edit") }}
          </UButton>
          <UButton
            color="error"
            variant="soft"
            icon="i-ph-trash"
            :aria-label="$t('saas.plans.action.delete')"
            @click="showDeleteModal = true"
          />
        </div>
      </template>
    </UCard>

    <UModal
      v-model:open="showDeleteModal"
      :title="$t('saas.plans.delete.action_title')"
    >
      <template #body>
        <DmsSaasDeletePlanModal
          :row-data="{
            _id: plan._id,
            name: plan.name,
            workspaceCount: plan.workspaceCount,
          }"
          :on-success-callback="onDeleted"
        />
      </template>
    </UModal>

    <UModal
      v-model:open="showConfirmDeactivateModal"
      :title="$t('saas.plans.deactivate.title', { name: plan.name })"
    >
      <template #body>
        <p>
          {{
            $t("saas.plans.deactivate.warning", { count: plan.workspaceCount })
          }}
        </p>
        <p class="text-muted text-sm mt-2">
          {{ $t("saas.plans.deactivate.public_removal") }}
        </p>
      </template>
      <template #footer>
        <div class="flex justify-end gap-2">
          <UButton variant="ghost" @click="showConfirmDeactivateModal = false">
            {{ $t("common.cancel") }}
          </UButton>
          <UButton color="warning" :loading="busy" @click="confirmDeactivate">
            {{ $t("saas.plans.deactivate.confirm") }}
          </UButton>
        </div>
      </template>
    </UModal>
  </div>
</template>
