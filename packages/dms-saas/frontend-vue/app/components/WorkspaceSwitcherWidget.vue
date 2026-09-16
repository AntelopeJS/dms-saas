<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";

const props = defineProps<{
  collapsed?: boolean;
}>();

interface DmsSaasPublicRuntimeConfig {
  admissionMode?: "open" | "invitation-only";
}

const toast = useToast();
const { t } = useI18n();
const { resolveApiError } = useApiErrorMessage();

// Platform owners are not tenant members by default, so an owner can legitimately
// have no workspace at all — the switcher must still offer them a way in.
const isOwner = useIsOwner();
const config = useDmsRuntimeConfig();
const canCreateWorkspace = computed(
  () =>
    isOwner.value ||
    (config.public.dmsSaas as DmsSaasPublicRuntimeConfig | undefined)
      ?.admissionMode !== "invitation-only",
);

const SEARCH_THRESHOLD = 6;
const HOME_ROUTE = "/";

const { workspaces, refresh } = useMyWorkspaces();
const isLoading = ref(true);
const isOpen = ref(false);
const isCreateOpen = ref(false);
const searchQuery = ref("");
const switchingId = ref<string | null>(null);

const current = computed<MyWorkspace | undefined>(
  () => workspaces.value.find((w) => w.isCurrent) ?? workspaces.value[0],
);

const showSearch = computed(() => workspaces.value.length >= SEARCH_THRESHOLD);

const isVisible = computed(() => !!current.value || isOwner.value);

const triggerLabel = computed(
  () => current.value?.name ?? t("saas.workspaces.none"),
);

const triggerCaption = computed(
  () => current.value?.planName ?? t("saas.workspaces.current_label"),
);

const filtered = computed<MyWorkspace[]>(() => {
  const needle = searchQuery.value.trim().toLowerCase();
  if (!needle) return workspaces.value;
  return workspaces.value.filter((w) => w.name.toLowerCase().includes(needle));
});

watch(isOpen, (open) => {
  if (!open) searchQuery.value = "";
});

const popoverPlacement = computed(() =>
  props.collapsed
    ? { side: "right" as const, align: "start" as const, sideOffset: 12 }
    : { side: "bottom" as const, align: "start" as const, sideOffset: 6 },
);

function initialOf(name: string): string {
  return (name.trim()[0] ?? "?").toUpperCase();
}

async function load(): Promise<void> {
  try {
    await refresh();
  } catch {
    // Errors are swallowed on purpose: useMyWorkspaces already decides what the
    // list becomes, and the sidebar is no place for an error card.
  } finally {
    isLoading.value = false;
  }
}

async function selectWorkspace(workspace: MyWorkspace): Promise<void> {
  if (workspace.isCurrent || switchingId.value) return;
  switchingId.value = workspace._id;
  try {
    // Reloads the page on success, so the switching state never resets.
    await useTenantSwitch(workspace._id);
  } catch (error) {
    switchingId.value = null;
    toast.add({
      title: resolveApiError(error, "saas.workspaces.switch_error"),
      color: "error",
      icon: "i-ph-warning-circle",
    });
  }
}

function openCreateModal(): void {
  isOpen.value = false;
  isCreateOpen.value = true;
}

async function onWorkspaceCreated(tenantId: string): Promise<void> {
  isCreateOpen.value = false;
  try {
    // Lands on the DMS homepage rather than reloading the settings screen the
    // creation was started from — that screen belongs to the previous tenant.
    await useTenantSwitch(tenantId, HOME_ROUTE);
  } catch (error) {
    toast.add({
      title: resolveApiError(error, "saas.workspaces.switch_error"),
      color: "error",
      icon: "i-ph-warning-circle",
    });
    load();
  }
}

onMounted(load);
</script>

<template>
  <USkeleton
    v-if="isLoading"
    :class="collapsed ? 'mx-auto size-9 rounded-md' : 'h-[46px] w-full rounded-md'"
  />
  <UPopover
    v-else-if="isVisible"
    v-model:open="isOpen"
    :content="popoverPlacement"
  >
    <UTooltip
      :text="triggerLabel"
      :disabled="!collapsed"
      :content="{ side: 'right' }"
    >
      <button
        type="button"
        class="border-default bg-elevated hover:border-accented flex w-full items-center rounded-md border text-left transition-colors"
        :class="collapsed ? 'mx-auto size-9 justify-center' : 'gap-2.5 px-2.5 py-2'"
        :aria-label="$t('saas.workspaces.switcher_title')"
      >
        <span
          class="bg-primary/10 text-primary grid size-7 shrink-0 place-items-center rounded-md text-xs font-semibold"
        >
          <UIcon v-if="!current" name="i-ph-buildings" class="size-4" />
          <template v-else>{{ initialOf(current.name) }}</template>
        </span>
        <template v-if="!collapsed">
          <span class="min-w-0 flex-1">
            <span class="text-muted block truncate text-[10px] font-medium uppercase tracking-wide">
              {{ triggerCaption }}
            </span>
            <span class="text-highlighted block truncate text-xs font-medium">
              {{ triggerLabel }}
            </span>
          </span>
          <UIcon
            name="i-ph-caret-up-down"
            class="text-dimmed size-4 shrink-0"
          />
        </template>
      </button>
    </UTooltip>

    <template #content>
      <div class="flex w-64 flex-col gap-1 p-2">
        <p class="text-muted px-2 pt-1 text-xs font-medium">
          {{ $t("saas.workspaces.switcher_title") }}
        </p>
        <UInput
          v-if="showSearch"
          v-model="searchQuery"
          size="sm"
          icon="i-ph-magnifying-glass"
          :placeholder="$t('saas.workspaces.select')"
        />
        <ul v-if="filtered.length" class="m-0 max-h-64 list-none overflow-y-auto p-0">
          <li v-for="workspace in filtered" :key="workspace._id">
            <button
              type="button"
              class="hover:bg-elevated flex w-full cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-sm transition-colors"
              :class="{ 'cursor-default': workspace.isCurrent || !!switchingId }"
              @click="selectWorkspace(workspace)"
            >
              <span
                class="bg-primary/10 text-primary grid size-6 shrink-0 place-items-center rounded-md text-[10px] font-semibold"
              >
                {{ initialOf(workspace.name) }}
              </span>
              <span
                class="min-w-0 flex-1 truncate"
                :class="workspace.isCurrent ? 'text-highlighted font-medium' : 'text-default'"
              >
                {{ workspace.name }}
              </span>
              <span
                v-if="workspace.planName"
                class="text-muted shrink-0 text-[10px] font-medium uppercase tracking-wide"
              >
                {{ workspace.planName }}
              </span>
              <UIcon
                v-if="switchingId === workspace._id"
                name="i-ph-spinner"
                class="text-muted size-4 shrink-0 animate-spin"
              />
              <UIcon
                v-else-if="workspace.isCurrent"
                name="i-ph-check"
                class="text-primary size-4 shrink-0"
              />
            </button>
          </li>
        </ul>
        <p v-else-if="workspaces.length" class="text-muted px-2 py-1.5 text-sm">
          {{ $t("saas.workspaces.no_results") }}
        </p>
        <USeparator v-if="workspaces.length" />
        <UButton
          v-if="canCreateWorkspace"
          variant="ghost"
          color="neutral"
          icon="i-ph-plus"
          size="sm"
          block
          class="justify-start"
          @click="openCreateModal"
        >
          {{ $t("saas.workspaces.create.button") }}
        </UButton>
      </div>
    </template>
  </UPopover>

  <UModal
    v-model:open="isCreateOpen"
    :title="$t('saas.workspaces.create.title')"
    :description="$t('saas.workspaces.create.self_serve.description')"
  >
    <template #body>
      <DmsSaasWorkspaceCreateModal :on-success-callback="onWorkspaceCreated" />
    </template>
  </UModal>
</template>
