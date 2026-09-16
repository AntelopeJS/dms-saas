<script setup lang="ts">
import { computed } from "vue";

interface Props {
  messages: SupportPageView<SupportMessageView>;
  events: SupportPageView<SupportTicketEventView>;
  assigneeLabels?: Record<string, string>;
}

interface HistoryEmits {
  attachment: [resourceKey: string];
  messagesPage: [page: number];
  eventsPage: [page: number];
}

const props = withDefaults(defineProps<Props>(), {
  assigneeLabels: () => ({}),
});
const emit = defineEmits<HistoryEmits>();
const { t } = useI18n();

const chronologicalMessages = computed(() =>
  [...props.messages.results].reverse(),
);
const messagesPage = computed(
  () => Math.floor(props.messages.offset / props.messages.limit) + 1,
);
const eventsPage = computed(
  () => Math.floor(props.events.offset / props.events.limit) + 1,
);

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function eventValue(
  event: SupportTicketEventView,
  value: string | null,
): string {
  if (!value) return t("saas.support.platform.unassigned");
  if (event.type === "status_changed")
    return t(`saas.support.status.${value}`);
  return props.assigneeLabels[value] ?? value;
}
</script>

<template>
  <section class="flex flex-col gap-4">
    <div class="flex items-center justify-between gap-3">
      <h3 class="font-medium">{{ $t("saas.support.conversation") }}</h3>
      <span v-if="messagesPage === 1" class="text-muted text-xs">
        {{ $t("saas.support.pagination.latest_page") }}
      </span>
    </div>
    <article
      v-for="message in chronologicalMessages"
      :key="message._id"
      class="rounded-lg p-4"
      :class="
        message.authorType === 'platform' ? 'bg-primary/10' : 'bg-elevated'
      "
    >
      <div class="text-muted mb-2 flex justify-between text-xs">
        <span>{{ $t(`saas.support.author.${message.authorType}`) }}</span>
        <time>{{ formatDate(message.createdAt) }}</time>
      </div>
      <p class="whitespace-pre-wrap text-sm">{{ message.body }}</p>
      <div
        v-if="message.attachments.length"
        class="mt-3 flex flex-wrap gap-2"
      >
        <UButton
          v-for="(attachment, index) in message.attachments"
          :key="attachment"
          size="xs"
          color="neutral"
          variant="outline"
          icon="i-ph-paperclip"
          @click="emit('attachment', attachment)"
        >
          {{ $t("saas.support.attachment", { number: index + 1 }) }}
        </UButton>
      </div>
    </article>
    <div
      v-if="messages.total > messages.limit"
      class="flex flex-col items-center gap-1"
    >
      <span class="text-muted text-xs">
        {{ $t("saas.support.pagination.older_messages") }}
      </span>
      <UPagination
        :page="messagesPage"
        :total="messages.total"
        :items-per-page="messages.limit"
        size="sm"
        @update:page="emit('messagesPage', $event)"
      />
    </div>
  </section>

  <USeparator />
  <section class="flex flex-col gap-3">
    <h3 class="font-medium">{{ $t("saas.support.history.title") }}</h3>
    <p v-if="!events.results.length" class="text-muted text-sm">
      {{ $t("saas.support.history.empty") }}
    </p>
    <div
      v-for="event in events.results"
      :key="event._id"
      class="bg-elevated rounded-lg p-3 text-sm"
    >
      <p>
        {{
          $t(`saas.support.history.${event.type}`, {
            actor: event.actorName,
            previous: eventValue(event, event.previousValue),
            next: eventValue(event, event.newValue),
          })
        }}
      </p>
      <time class="text-muted text-xs">
        {{ formatDate(event.createdAt) }}
      </time>
    </div>
    <UPagination
      v-if="events.total > events.limit"
      :page="eventsPage"
      :total="events.total"
      :items-per-page="events.limit"
      size="sm"
      class="self-center"
      @update:page="emit('eventsPage', $event)"
    />
  </section>
</template>
