<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";

type TargetType = "user" | "workspace";

interface PlatformNote {
  _id: string;
  targetType: TargetType;
  targetId: string;
  authorId: string;
  authorName: string | null;
  authorEmail: string | null;
  content: string;
  createdAt: string;
  updatedAt: string;
}

interface NotesPage {
  items: PlatformNote[];
  total: number;
  page: number;
  pageSize: number;
}

const MAX_CONTENT_LENGTH = 4000;
const PAGE_SIZE = 5;

const props = defineProps<{
  targetType: TargetType;
  routeParams?: Record<string, string>;
}>();

// The card and its delete modal are sibling roots, so the renderer's extra
// attributes (page and component ids) have no single element to land on.
defineOptions({ inheritAttrs: false });

const { $authFetch } = useAuthFetch();
const { t } = useI18n();
const toast = useToast();
const { resolveServerMessage } = useApiErrorMessage();

const targetId = computed(() => props.routeParams?.id ?? "");
const baseUrl = computed(
  () => `/api/saas/platform-notes/${props.targetType}/${targetId.value}`,
);

const notes = ref<PlatformNote[]>([]);
const total = ref(0);
const currentPage = ref(1);
const isLoading = ref(false);
const isSubmitting = ref(false);
const isDeleting = ref(false);
const draft = ref("");
const pendingDelete = ref<PlatformNote | null>(null);
const isDeleteOpen = computed({
  get: () => pendingDelete.value !== null,
  set: (value: boolean) => {
    if (!value) pendingDelete.value = null;
  },
});

const canSubmit = computed(
  () =>
    !isSubmitting.value &&
    draft.value.trim().length > 0 &&
    draft.value.trim().length <= MAX_CONTENT_LENGTH,
);

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function authorDisplay(note: PlatformNote): string {
  return note.authorName || note.authorEmail || note.authorId;
}

async function fetchPage(page: number): Promise<NotesPage> {
  const query = new URLSearchParams({
    page: String(page),
    pageSize: String(PAGE_SIZE),
  });
  return $authFetch<NotesPage>(`${baseUrl.value}?${query.toString()}`);
}

async function load(page: number): Promise<void> {
  if (!targetId.value) return;
  isLoading.value = true;
  try {
    const result = await fetchPage(page);
    notes.value = result.items;
    total.value = result.total;
    const totalPages = Math.max(1, Math.ceil(result.total / PAGE_SIZE));
    if (page > totalPages) {
      currentPage.value = totalPages;
      const fallback = await fetchPage(totalPages);
      notes.value = fallback.items;
      total.value = fallback.total;
    } else {
      currentPage.value = page;
    }
  } catch (error) {
    toast.add({
      color: "error",
      icon: "i-ph-warning",
      title: t("saas.notes.error.load"),
      description: resolveServerMessage(error),
    });
  } finally {
    isLoading.value = false;
  }
}

async function submit(): Promise<void> {
  if (!canSubmit.value) return;
  isSubmitting.value = true;
  try {
    await $authFetch<PlatformNote>(baseUrl.value, {
      method: "POST",
      body: { content: draft.value.trim() },
    });
    draft.value = "";
    await load(1);
  } catch (error) {
    toast.add({
      color: "error",
      icon: "i-ph-warning",
      title: t("saas.notes.error.create"),
      description: resolveServerMessage(error),
    });
  } finally {
    isSubmitting.value = false;
  }
}

function requestDelete(note: PlatformNote): void {
  pendingDelete.value = note;
}

async function confirmDelete(): Promise<void> {
  const note = pendingDelete.value;
  if (!note) return;
  isDeleting.value = true;
  try {
    await $authFetch(`/api/saas/platform-notes/${note._id}`, {
      method: "DELETE",
    });
    pendingDelete.value = null;
    await load(currentPage.value);
  } catch (error) {
    toast.add({
      color: "error",
      icon: "i-ph-warning",
      title: t("saas.notes.error.delete"),
      description: resolveServerMessage(error),
    });
  } finally {
    isDeleting.value = false;
  }
}

watch(currentPage, (page) => {
  load(page);
});

onMounted(() => load(1));
</script>

<template>
  <DmsCard>
    <div
      class="-mx-5 sm:-mx-6 -mt-5 sm:-mt-6 mb-5 sm:mb-6 border-b border-default px-5 sm:px-6 py-4"
    >
      <div class="flex items-center gap-2">
        <UIcon name="i-ph-note-pencil" />
        <h3 class="font-semibold">{{ $t("saas.notes.title") }}</h3>
      </div>
    </div>

    <div class="flex flex-col gap-3">
      <UTextarea
        v-model="draft"
        :placeholder="$t('saas.notes.placeholder')"
        :rows="3"
        :maxlength="MAX_CONTENT_LENGTH"
        autoresize
      />
      <div class="flex justify-end">
        <UButton
          size="sm"
          color="primary"
          icon="i-ph-plus"
          :loading="isSubmitting"
          :disabled="!canSubmit"
          @click="submit"
        >
          {{ $t("saas.notes.add") }}
        </UButton>
      </div>

      <USeparator />

      <div v-if="isLoading" class="flex justify-center py-3">
        <UIcon name="i-ph-spinner" class="animate-spin" />
      </div>
      <p
        v-else-if="total === 0"
        class="text-sm italic text-muted py-2 text-center"
      >
        {{ $t("saas.notes.empty") }}
      </p>
      <template v-else>
        <ul class="flex flex-col gap-3">
          <li
            v-for="note in notes"
            :key="note._id"
            class="rounded-md bg-elevated/40 p-3 flex flex-col gap-2"
          >
            <div class="flex items-start justify-between gap-2">
              <div class="text-xs text-muted">
                <span class="font-medium text-default">{{
                  authorDisplay(note)
                }}</span>
                · {{ formatDateTime(note.createdAt) }}
              </div>
              <UButton
                icon="i-ph-trash"
                color="neutral"
                variant="ghost"
                size="xs"
                :aria-label="$t('saas.notes.delete')"
                @click="requestDelete(note)"
              />
            </div>
            <p class="text-sm whitespace-pre-wrap break-words">
              {{ note.content }}
            </p>
          </li>
        </ul>
        <div v-if="total > PAGE_SIZE" class="flex justify-center pt-2">
          <UPagination
            v-model:page="currentPage"
            :total="total"
            :items-per-page="PAGE_SIZE"
            :sibling-count="1"
            size="sm"
          />
        </div>
      </template>
    </div>
  </DmsCard>

  <UModal v-model:open="isDeleteOpen" :title="$t('saas.notes.delete_confirm.title')">
    <template #body>
      <p class="text-sm">
        {{ $t("saas.notes.delete_confirm.description") }}
      </p>
      <blockquote
        v-if="pendingDelete"
        class="mt-3 rounded-md bg-elevated/40 p-3 text-sm whitespace-pre-wrap break-words border-l-2 border-default"
      >
        {{ pendingDelete.content }}
      </blockquote>
    </template>
    <template #footer>
      <div class="flex justify-end gap-2">
        <UButton
          variant="ghost"
          :disabled="isDeleting"
          @click="isDeleteOpen = false"
        >
          {{ $t("common.cancel") }}
        </UButton>
        <UButton color="error" :loading="isDeleting" @click="confirmDelete">
          {{ $t("saas.notes.delete_confirm.confirm") }}
        </UButton>
      </div>
    </template>
  </UModal>
</template>
