<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { sendSupportRequest } from "../composables/useSupportRequest";
import SupportAttachmentUpload from "./SupportAttachmentUpload.vue";
import SupportThreadHistory from "./SupportThreadHistory.vue";

const { $authFetch } = useAuthFetch();
const { t } = useI18n();
const toast = useToast();
const { resolveApiError } = useApiErrorMessage();

const tickets = ref<SupportTicketView[]>([]);
const selected = ref<SupportThreadView | null>(null);
const config = ref<SupportConfigView | null>(null);
const isLoading = ref(true);
const isSubmitting = ref(false);
const isReplyUploading = ref(false);
const isDraftUploading = ref(false);
const isCreateOpen = ref(false);
const replyBody = ref("");
const replyAttachments = ref<string[]>([]);
const PAGE_SIZE = 20;
const listPage = ref(1);
const messagesPage = ref(1);
const eventsPage = ref(1);
const ticketTotal = ref(0);
let selectionRequest = 0;
let messagesRequest = 0;
let eventsRequest = 0;
let listRequest = 0;

const draft = reactive<SupportTicketDraft>({
  subject: "",
  category: "question",
  priority: "normal",
  body: "",
  attachments: [],
});

const categoryItems = [
  "question",
  "incident",
  "billing",
  "feature_request",
].map((value) => ({ value, label: t(`saas.support.category.${value}`) }));
const priorityItems = computed(() =>
  (config.value?.policy.priorities ?? []).map((value) => ({
    value,
    label: t(`saas.support.priority.${value}`),
  })),
);
const attachmentConstraints = computed(() => ({
  maxSize: config.value?.maxAttachmentSize,
  allowedMimetypes: config.value?.allowedMimetypes,
}));

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function resetDraft(): void {
  draft.subject = "";
  draft.category = "question";
  draft.priority = config.value?.policy.priorities[0] ?? "normal";
  draft.body = "";
  draft.attachments = [];
}

function pageQuery(page: number, sortKey: string): string {
  return new URLSearchParams({
    offset: String((page - 1) * PAGE_SIZE),
    limit: String(PAGE_SIZE),
    sortKey,
    sortDirection: "desc",
  }).toString();
}

async function load(): Promise<void> {
  const request = ++listRequest;
  isLoading.value = true;
  try {
    const [loadedConfig, loadedTickets] = await Promise.all([
      $authFetch<SupportConfigView>("/api/saas/support/config"),
      $authFetch<SupportPageView<SupportTicketView>>(
        `/api/saas/tenant/tables/support-tickets/list?${pageQuery(listPage.value, "lastMessageAt")}`,
      ),
    ]);
    if (request !== listRequest) return;
    config.value = loadedConfig;
    tickets.value = loadedTickets.results;
    ticketTotal.value = loadedTickets.total;
    if (!loadedConfig.policy.priorities.includes(draft.priority)) resetDraft();
  } catch (error) {
    showError(error, "saas.support.error.load");
  } finally {
    if (request === listRequest) isLoading.value = false;
  }
}

async function selectTicket(ticketId: string): Promise<void> {
  messagesPage.value = 1;
  eventsPage.value = 1;
  const request = ++selectionRequest;
  const messageRequest = ++messagesRequest;
  const eventRequest = ++eventsRequest;
  const baseUrl = `/api/saas/support/${ticketId}`;
  try {
    const [detail, messages, events] = await Promise.all([
      $authFetch<SupportTicketDetailView>(baseUrl),
      $authFetch<SupportPageView<SupportMessageView>>(
        `${baseUrl}/messages/list?${pageQuery(messagesPage.value, "createdAt")}`,
      ),
      $authFetch<SupportPageView<SupportTicketEventView>>(
        `${baseUrl}/events/list?${pageQuery(eventsPage.value, "createdAt")}`,
      ),
    ]);
    if (
      request === selectionRequest &&
      messageRequest === messagesRequest &&
      eventRequest === eventsRequest
    ) {
      selected.value = { ticket: detail.ticket, messages, events };
    }
  } catch (error) {
    showError(error, "saas.support.error.load");
  }
}

async function createTicket(): Promise<void> {
  if (!draft.subject.trim() || !draft.body.trim()) return;
  isSubmitting.value = true;
  try {
    const ticket = await sendSupportRequest(
      `${config.value?.uploadPath}:create`,
      draft,
      (body) =>
        $authFetch<SupportTicketView>("/api/saas/support", {
          method: "POST",
          body,
        }),
    );
    isCreateOpen.value = false;
    resetDraft();
    listPage.value = 1;
    await load();
    await selectTicket(ticket._id);
    toast.add({
      title: t("saas.support.tenant.created"),
      color: "success",
    });
  } catch (error) {
    showError(error, "saas.support.error.create");
  } finally {
    isSubmitting.value = false;
  }
}

async function sendReply(): Promise<void> {
  if (!selected.value || !replyBody.value.trim()) return;
  const ticketId = selected.value.ticket._id;
  isSubmitting.value = true;
  try {
    await sendSupportRequest(
      `${config.value?.uploadPath}:${ticketId}:reply`,
      { body: replyBody.value, attachments: replyAttachments.value },
      (body) =>
        $authFetch(`/api/saas/support/${ticketId}/messages`, {
          method: "POST",
          body,
        }),
    );
    replyBody.value = "";
    replyAttachments.value = [];
    if (selected.value?.ticket._id === ticketId) await selectTicket(ticketId);
    await load();
  } catch (error) {
    showError(error, "saas.support.error.reply");
  } finally {
    isSubmitting.value = false;
  }
}

async function openAttachment(
  ticketId: string,
  resourceKey: string,
): Promise<void> {
  try {
    const query = new URLSearchParams({ resourceKey });
    const file = await $authFetch<SupportAttachmentView>(
      `/api/saas/support/${ticketId}/attachment?${query}`,
    );
    window.open(file.url, "_blank", "noopener,noreferrer");
  } catch (error) {
    showError(error, "saas.support.error.attachment");
  }
}

function showError(error: unknown, fallback: string): void {
  toast.add({
    title: resolveApiError(error, fallback),
    color: "error",
    icon: "i-ph-warning-circle",
  });
}

onMounted(load);

function changeListPage(page: number): void {
  listPage.value = page;
  void load();
}

function changeThreadPage(kind: "messages" | "events", page: number): void {
  if (!selected.value) return;
  const pages = { messages: messagesPage, events: eventsPage };
  pages[kind].value = page;
  void loadThreadPage(kind, selected.value.ticket._id);
}

async function loadThreadPage(
  kind: "messages" | "events",
  ticketId: string,
): Promise<void> {
  const requests = { messages: messagesRequest, events: eventsRequest };
  const request = ++requests[kind];
  if (kind === "messages") messagesRequest = request;
  else eventsRequest = request;
  try {
    const page = await $authFetch<
      SupportPageView<SupportMessageView | SupportTicketEventView>
    >(
      `/api/saas/support/${ticketId}/${kind}/list?${pageQuery(kind === "messages" ? messagesPage.value : eventsPage.value, "createdAt")}`,
    );
    const currentRequest =
      kind === "messages" ? messagesRequest : eventsRequest;
    if (request !== currentRequest || selected.value?.ticket._id !== ticketId)
      return;
    if (kind === "messages") {
      selected.value.messages = page as SupportPageView<SupportMessageView>;
    } else {
      selected.value.events = page as SupportPageView<SupportTicketEventView>;
    }
  } catch (error) {
    showError(error, "saas.support.error.load");
  }
}
</script>

<template>
  <div class="grid gap-6 xl:grid-cols-[22rem_1fr]">
    <div class="flex flex-col gap-4">
      <UAlert
        v-if="config"
        color="primary"
        variant="subtle"
        icon="i-ph-clock-countdown"
        :title="$t(`saas.support.sla.${config.policy.level}.title`)"
        :description="$t(`saas.support.sla.${config.policy.level}.description`)"
      />
      <UButton icon="i-ph-plus" block @click="isCreateOpen = true">
        {{ $t("saas.support.tenant.new") }}
      </UButton>
      <USkeleton v-if="isLoading" class="h-32" />
      <UCard v-else-if="!tickets.length">
        <p class="text-muted text-center text-sm">
          {{ $t("saas.support.tenant.empty") }}
        </p>
      </UCard>
      <template v-else>
        <button
          v-for="ticket in tickets"
          :key="ticket._id"
          class="border-default hover:bg-elevated rounded-lg border p-4 text-left"
          :class="{
            'ring-primary ring-2': selected?.ticket._id === ticket._id,
          }"
          @click="selectTicket(ticket._id)"
        >
          <div class="flex items-start justify-between gap-2">
            <p class="font-medium">{{ ticket.subject }}</p>
            <UBadge size="sm" variant="subtle">
              {{ $t(`saas.support.status.${ticket.status}`) }}
            </UBadge>
          </div>
          <p class="text-muted mt-2 text-xs">
            {{ formatDate(ticket.lastMessageAt) }}
          </p>
        </button>
        <UPagination
          v-if="ticketTotal > PAGE_SIZE"
          :page="listPage"
          :total="ticketTotal"
          :items-per-page="PAGE_SIZE"
          size="sm"
          class="self-center"
          @update:page="changeListPage"
        />
      </template>
    </div>

    <UCard v-if="selected">
      <template #header>
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 class="text-lg font-semibold">
              {{ selected.ticket.subject }}
            </h2>
            <p class="text-muted text-sm">
              {{ $t(`saas.support.category.${selected.ticket.category}`) }}
              ·
              {{ $t(`saas.support.priority.${selected.ticket.priority}`) }}
            </p>
          </div>
          <UBadge>
            {{ $t(`saas.support.status.${selected.ticket.status}`) }}
          </UBadge>
        </div>
      </template>
      <div class="flex flex-col gap-4">
        <SupportThreadHistory
          :messages="selected.messages"
          :events="selected.events"
          @attachment="openAttachment(selected.ticket._id, $event)"
          @messages-page="changeThreadPage('messages', $event)"
          @events-page="changeThreadPage('events', $event)"
        />
        <USeparator />
        <UTextarea
          v-model="replyBody"
          :placeholder="$t('saas.support.reply_placeholder')"
          :rows="4"
          class="w-full"
        />
        <SupportAttachmentUpload
          v-if="config"
          v-model="replyAttachments"
          multiple
          :constraints="attachmentConstraints"
          :disabled="isSubmitting"
          @busy="isReplyUploading = $event"
        />
        <div class="flex justify-end">
          <UButton
            :loading="isSubmitting"
            :disabled="isReplyUploading"
            @click="sendReply"
          >
            {{ $t("saas.support.send") }}
          </UButton>
        </div>
      </div>
    </UCard>
    <UCard v-else class="min-h-64">
      <div class="text-muted flex h-full items-center justify-center text-sm">
        {{ $t("saas.support.tenant.select") }}
      </div>
    </UCard>
  </div>

  <UModal v-model:open="isCreateOpen" :title="$t('saas.support.tenant.new')">
    <template #body>
      <div class="flex flex-col gap-4">
        <UFormField :label="$t('saas.support.subject')" required>
          <UInput v-model="draft.subject" class="w-full" />
        </UFormField>
        <div class="grid gap-4 sm:grid-cols-2">
          <UFormField :label="$t('saas.support.category.label')" required>
            <USelect
              v-model="draft.category"
              :items="categoryItems"
              class="w-full"
            />
          </UFormField>
          <UFormField :label="$t('saas.support.priority.label')" required>
            <USelect
              v-model="draft.priority"
              :items="priorityItems"
              class="w-full"
            />
          </UFormField>
        </div>
        <UFormField :label="$t('saas.support.message')" required>
          <UTextarea v-model="draft.body" :rows="5" class="w-full" />
        </UFormField>
        <UFormField :label="$t('saas.support.attachments')">
          <SupportAttachmentUpload
            v-if="config"
            v-model="draft.attachments"
            multiple
            :constraints="attachmentConstraints"
            :disabled="isSubmitting"
            @busy="isDraftUploading = $event"
          />
        </UFormField>
      </div>
    </template>
    <template #footer>
      <div class="flex w-full justify-end gap-2">
        <UButton color="neutral" variant="ghost" @click="isCreateOpen = false">
          {{ $t("common.cancel") }}
        </UButton>
        <UButton
          :loading="isSubmitting"
          :disabled="isDraftUploading"
          @click="createTicket"
        >
          {{ $t("saas.support.tenant.create") }}
        </UButton>
      </div>
    </template>
  </UModal>
</template>
