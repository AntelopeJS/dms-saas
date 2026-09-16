<script setup lang="ts" generic="T extends { _id: string }">
import { computed, ref } from "vue";

const DEFAULT_PAGE_SIZE = 24;

const props = defineProps<{
  items: T[];
  pageSize?: number;
  draggable?: boolean;
}>();

const emit = defineEmits<{
  reorder: [items: T[]];
}>();

const visibleCount = ref(props.pageSize ?? DEFAULT_PAGE_SIZE);
const draggedIndex = ref<number | null>(null);

const visibleItems = computed<T[]>(() =>
  props.items.slice(0, visibleCount.value),
);

function loadMore(): void {
  visibleCount.value += props.pageSize ?? DEFAULT_PAGE_SIZE;
}

function onDragStart(index: number): void {
  draggedIndex.value = index;
}

function onDrop(targetIndex: number): void {
  if (draggedIndex.value === null || draggedIndex.value === targetIndex) {
    draggedIndex.value = null;
    return;
  }
  const reordered = [...props.items];
  const [moved] = reordered.splice(draggedIndex.value, 1);
  if (moved === undefined) {
    draggedIndex.value = null;
    return;
  }
  reordered.splice(targetIndex, 0, moved);
  draggedIndex.value = null;
  emit("reorder", reordered);
}

function onDragOver(event: DragEvent): void {
  event.preventDefault();
}
</script>

<template>
  <div class="flex flex-col gap-4">
    <div class="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-4">
      <div
        v-for="(item, index) in visibleItems"
        :key="item._id"
        :draggable="draggable"
        class="cursor-grab"
        :class="{ 'opacity-50': draggedIndex === index }"
        @dragstart="onDragStart(index)"
        @dragover="onDragOver"
        @drop="onDrop(index)"
      >
        <slot name="card" :item="item" />
      </div>
    </div>
    <div
      v-if="visibleItems.length < items.length"
      class="flex justify-center"
    >
      <UButton variant="soft" @click="loadMore">
        {{ $t("common.load_more") }}
      </UButton>
    </div>
  </div>
</template>
