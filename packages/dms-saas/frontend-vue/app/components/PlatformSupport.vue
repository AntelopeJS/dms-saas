<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { sendSupportRequest } from "../composables/useSupportRequest";
import SupportThreadHistory from "./SupportThreadHistory.vue";

const { $authFetch } = useAuthFetch();
const { t } = useI18n();
const toast = useToast();
const { resolveApiError } = useApiErrorMessage();

const FILTER_ALL = "all";
const ASSIGNEE_UNASSIGNED = "unassigned";

const inbox = ref<PlatformSupportTicketView[]>([]);
const owners = ref<PlatformOwnerOptionView[]>([]);
const selected = ref<PlatformSupportThreadView | null>(null);
const statusFilter = ref<string>(FILTER_ALL);
const priorityFilter = ref<string>(FILTER_ALL);
const isLoading = ref(true);
const isSubmitting = ref(false);
const replyBody = ref("");
const PAGE_SIZE = 20;
const OWNER_PAGE_SIZE = 100;
const listPage = ref(1);
const messagesPage = ref(1);
const eventsPage = ref(1);
const inboxTotal = ref(0);
let selectionRequest = 0;
let messagesRequest = 0;
let eventsRequest = 0;
let inboxRequest = 0;

const statusItems = [
  { value: FILTER_ALL, label: t("saas.support.filters.all_statuses") },
  ...["open", "in_progress", "waiting_customer", "resolved", "closed"].map(
    (value) => ({ value, label: t(`saas.support.status.${value}`) }),
  ),
];
const priorityItems = [
  { value: FILTER_ALL, label: t("saas.support.filters.all_priorities") },
  ...["low", "normal", "high", "urgent"].map((value) => ({
    value,
    label: t(`saas.support.priority.${value}`),
  })),
];
const assignmentItems = computed(() => [
  {
    value: ASSIGNEE_UNASSIGNED,
    label: t("saas.support.platform.unassigned"),
  },
  ...owners.value.map((owner) => ({
    value: owner._id,
    label: owner.name || owner.email || owner._id,
  })),
]);
const assigneeLabels = computed<Record<string, string>>(() =>
  Object.fromEntries(
    owners.value.map((owner) => [
      owner._id,
      owner.name || owner.email || owner._id,
    ]),
  ),
);

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function inboxQuery(): string {
  const query = new URLSearchParams({
    offset: String((listPage.value - 1) * PAGE_SIZE),
    limit: String(PAGE_SIZE),
    sortKey: "lastMessageAt",
    sortDirection: "desc",
  });
  if (statusFilter.value !== FILTER_ALL) {
    query.set("filter_status", `is:${statusFilter.value}`);
  }
  if (priorityFilter.value !== FILTER_ALL) {
    query.set("filter_priority", `is:${priorityFilter.value}`);
  }
  return query.toString();
}

function threadQuery(page: number): string {
  return new URLSearchParams({
    offset: String((page - 1) * PAGE_SIZE),
    limit: String(PAGE_SIZE),
    sortKey: "createdAt",
    sortDirection: "desc",
  }).toString();
}

async function loadInbox(): Promise<void> {
  const request = ++inboxRequest;
  isLoading.value = true;
  try {
    const suffix = inboxQuery();
    const page = await $authFetch<SupportPageView<PlatformSupportTicketView>>(
      `/api/saas/tables/support-tickets/list?${suffix}`,
    );
    if (request !== inboxRequest) return;
    inbox.value = page.results;
    inboxTotal.value = page.total;
  } catch (error) {
    showError(error, "saas.support.error.load");
  } finally {
    if (request === inboxRequest) isLoading.value = false;
  }
}

async function loadOwners(): Promise<void> {
  try {
    const loadedOwners: PlatformOwnerOptionView[] = [];
    let offset = 0;
    let total = 0;
    do {
      const query = new URLSearchParams({
        offset: String(offset),
        limit: String(OWNER_PAGE_SIZE),
      });
      const page = await $authFetch<SupportPageView<PlatformOwnerOptionView>>(
        `/api/saas/tables/support-owners/list?${query}`,
      );
      loadedOwners.push(...page.results);
      if (!page.results.length) break;
      offset += page.results.length;
      total = page.total;
    } while (offset < total);
    owners.value = loadedOwners;
  } catch (error) {
    showError(error, "saas.support.error.load");
  }
}

async function selectTicket(
  ticket: PlatformSupportTicketView,
): Promise<void> {
  messagesPage.value = 1;
  eventsPage.value = 1;
  const request = ++selectionRequest;
  const messageRequest = ++messagesRequest;
  const eventRequest = ++eventsRequest;
  const baseUrl = `/api/saas/support/platform/${ticket._instance}/${ticket._id}`;
  try {
    const [detail, messages, events] = await Promise.all([
      $authFetch<PlatformSupportTicketDetailView>(baseUrl),
      $authFetch<SupportPageView<SupportMessageView>>(
        `${baseUrl}/messages/list?${threadQuery(messagesPage.value)}`,
      ),
      $authFetch<SupportPageView<SupportTicketEventView>>(
        `${baseUrl}/events/list?${threadQuery(eventsPage.value)}`,
      ),
    ]);
    if (
      request === selectionRequest &&
      messageRequest === messagesRequest &&
      eventRequest === eventsRequest
    ) {
      selected.value = { ...detail, messages, events };
    }
  } catch (error) {
    showError(error, "saas.support.error.load");
  }
}

async function updateTicket(patch: SupportTicketPatch): Promise<void> {
  if (!selected.value) return;
  isSubmitting.value = true;
  const { tenantId, ticket } = selected.value;
  try {
    await sendSupportRequest(
      `platform:${tenantId}:${ticket._id}:update`,
      patch,
      (body) =>
        $authFetch(`/api/saas/support/platform/${tenantId}/${ticket._id}`, {
          method: "PUT",
          body,
        }),
    );
    eventsPage.value = 1;
    await Promise.all([
      loadInbox(),
      refreshDetail(),
      loadThreadPage("events"),
    ]);
  } catch (error) {
    showError(error, "saas.support.error.update");
  } finally {
    isSubmitting.value = false;
  }
}

function changeStatus(status: string): void {
  void updateTicket({ status: status as SupportStatus });
}

function changeAssignment(assignedTo: string): void {
  void updateTicket({
    assignedTo: assignedTo === ASSIGNEE_UNASSIGNED ? null : assignedTo,
  });
}

async function sendReply(): Promise<void> {
  if (!selected.value || !replyBody.value.trim()) return;
  const { tenantId, ticket } = selected.value;
  isSubmitting.value = true;
  try {
    await sendSupportRequest(
      `platform:${tenantId}:${ticket._id}:reply`,
      { body: replyBody.value, attachments: [] },
      (body) =>
        $authFetch(
          `/api/saas/support/platform/${tenantId}/${ticket._id}/messages`,
          { method: "POST", body },
        ),
    );
    replyBody.value = "";
    messagesPage.value = 1;
    eventsPage.value = 1;
    await Promise.all([
      loadInbox(),
      refreshDetail(),
      loadThreadPage("messages"),
      loadThreadPage("events"),
    ]);
  } catch (error) {
    showError(error, "saas.support.error.reply");
  } finally {
    isSubmitting.value = false;
  }
}

async function openAttachment(resourceKey: string): Promise<void> {
  if (!selected.value) return;
  const { tenantId, ticket } = selected.value;
  const query = new URLSearchParams({ resourceKey });
  try {
    const file = await $authFetch<SupportAttachmentView>(
      `/api/saas/support/platform/${tenantId}/${ticket._id}/attachment?${query}`,
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

onMounted(() => Promise.all([loadInbox(), loadOwners()]));

function applyFilters(): void {
  listPage.value = 1;
  void loadInbox();
}

function changeListPage(page: number): void {
  listPage.value = page;
  void loadInbox();
}

async function refreshDetail(): Promise<void> {
  if (!selected.value) return Promise.resolve();
  const { tenantId, ticket } = selected.value;
  const request = ++selectionRequest;
  const detail = await $authFetch<PlatformSupportTicketDetailView>(
    `/api/saas/support/platform/${tenantId}/${ticket._id}`,
  );
  if (
    request === selectionRequest &&
    selected.value?.ticket._id === ticket._id &&
    selected.value?.tenantId === tenantId
  ) {
    Object.assign(selected.value, detail);
  }
}

function changeThreadPage(kind: "messages" | "events", page: number): void {
  const pages = { messages: messagesPage, events: eventsPage };
  pages[kind].value = page;
  void loadThreadPage(kind);
}

async function loadThreadPage(kind: "messages" | "events"): Promise<void> {
  if (!selected.value) return;
  const { tenantId, ticket } = selected.value;
  const request = kind === "messages" ? ++messagesRequest : ++eventsRequest;
  const pageNumber =
    kind === "messages" ? messagesPage.value : eventsPage.value;
  try {
    const page = await $authFetch<
      SupportPageView<SupportMessageView | SupportTicketEventView>
    >(
      `/api/saas/support/platform/${tenantId}/${ticket._id}/${kind}/list?${threadQuery(pageNumber)}`,
    );
    const currentRequest =
      kind === "messages" ? messagesRequest : eventsRequest;
    if (
      request !== currentRequest ||
      selected.value?.ticket._id !== ticket._id ||
      selected.value?.tenantId !== tenantId
    )
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
  <div class="flex flex-col gap-5">
    <UCard>
      <div class="flex flex-wrap items-end gap-4">
        <UFormField
          :label="$t('saas.support.filters.status')"
          class="min-w-48"
        >
          <USelect
            v-model="statusFilter"
            :items="statusItems"
            class="w-full"
          />
        </UFormField>
        <UFormField
          :label="$t('saas.support.filters.priority')"
          class="min-w-48"
        >
          <USelect
            v-model="priorityFilter"
            :items="priorityItems"
            class="w-full"
          />
        </UFormField>
        <UButton color="neutral" variant="outline" @click="applyFilters">
          {{ $t("saas.support.filters.apply") }}
        </UButton>
      </div>
    </UCard>

    <div class="grid gap-6 xl:grid-cols-[24rem_1fr]">
      <div class="flex flex-col gap-3">
        <USkeleton v-if="isLoading" class="h-40" />
        <UCard v-else-if="!inbox.length">
          <p class="text-muted text-center text-sm">
            {{ $t("saas.support.platform.empty") }}
          </p>
        </UCard>
        <template v-else>
          <button
            v-for="ticket in inbox"
            :key="`${ticket._instance}:${ticket._id}`"
            class="border-default hover:bg-elevated rounded-lg border p-4 text-left"
            :class="{
              'ring-primary ring-2':
                selected?.ticket._id === ticket._id &&
                selected?.tenantId === ticket._instance,
            }"
            @click="selectTicket(ticket)"
          >
            <div class="flex justify-between gap-2">
              <p class="font-medium">{{ ticket.subject }}</p>
              <UBadge size="sm" variant="subtle">
                {{ $t(`saas.support.priority.${ticket.priority}`) }}
              </UBadge>
            </div>
            <p class="text-muted mt-1 text-sm">{{ ticket.tenantName }}</p>
            <div class="text-muted mt-3 flex justify-between text-xs">
              <span>{{ $t(`saas.support.status.${ticket.status}`) }}</span>
              <span>{{ formatDate(ticket.lastMessageAt) }}</span>
            </div>
          </button>
          <UPagination
            v-if="inboxTotal > PAGE_SIZE"
            :page="listPage"
            :total="inboxTotal"
            :items-per-page="PAGE_SIZE"
            size="sm"
            class="self-center"
            @update:page="changeListPage"
          />
        </template>
      </div>

      <UCard v-if="selected">
        <template #header>
          <div>
            <p class="text-muted text-sm">{{ selected.tenantName }}</p>
            <h2 class="text-lg font-semibold">
              {{ selected.ticket.subject }}
            </h2>
          </div>
        </template>
        <div class="flex flex-col gap-5">
          <div class="grid gap-4 sm:grid-cols-2">
            <UFormField :label="$t('saas.support.filters.status')">
              <USelect
                :model-value="selected.ticket.status"
                :items="statusItems.slice(1)"
                class="w-full"
                :disabled="isSubmitting"
                @update:model-value="changeStatus"
              />
            </UFormField>
            <UFormField :label="$t('saas.support.platform.assignee')">
              <USelect
                :model-value="
                  selected.ticket.assignedTo ?? ASSIGNEE_UNASSIGNED
                "
                :items="assignmentItems"
                class="w-full"
                :disabled="isSubmitting"
                @update:model-value="changeAssignment"
              />
            </UFormField>
          </div>
          <USeparator />
          <SupportThreadHistory
            :messages="selected.messages"
            :events="selected.events"
            :assignee-labels="assigneeLabels"
            @attachment="openAttachment"
            @messages-page="changeThreadPage('messages', $event)"
            @events-page="changeThreadPage('events', $event)"
          />
          <UTextarea
            v-model="replyBody"
            :rows="5"
            :placeholder="$t('saas.support.reply_placeholder')"
            class="w-full"
          />
          <div class="flex justify-end">
            <UButton :loading="isSubmitting" @click="sendReply">
              {{ $t("saas.support.send") }}
            </UButton>
          </div>
        </div>
      </UCard>
      <UCard v-else class="min-h-64">
        <div
          class="text-muted flex h-full items-center justify-center text-sm"
        >
          {{ $t("saas.support.platform.select") }}
        </div>
      </UCard>
    </div>
  </div>
</template>
