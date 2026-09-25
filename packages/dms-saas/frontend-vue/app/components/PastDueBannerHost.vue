<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, shallowRef } from "vue";

defineProps<{ collapsed?: boolean }>();

const HOST_ID = "dms-saas-past-due-banner-host";
const PAGE_REGION_SELECTOR = "[data-dms-page-region]";

/**
 * Mounted as a global sidebar widget only because the sidebar is present on
 * every tenant page: the DMS layout has no banner slot. The banner itself is
 * teleported into a host node kept as the first child of the page region.
 */
const ownership = Symbol("past-due-banner-host");
const host = shallowRef<HTMLElement | null>(null);
const accessCache = useWorkspaceAccessCache();
let observer: MutationObserver | null = null;

const isVisible = computed(() =>
  isPastDueBannerVisible(accessCache.value?.access ?? null),
);

/**
 * Keeps the host at the top of whichever page region is on screen. A page
 * change can swap the region; the host node moves along and keeps the
 * teleported banner inside it. Moving it re-triggers the observer, which is
 * then a no-op because the host is already in place.
 */
function placeHost(): void {
  const element = host.value;
  const region = document.querySelector(PAGE_REGION_SELECTOR);
  if (!element || !region || region.firstElementChild === element) return;
  region.prepend(element);
}

function createHost(): HTMLElement {
  document.getElementById(HOST_ID)?.remove();
  const element = document.createElement("div");
  element.id = HOST_ID;
  return element;
}

onMounted(() => {
  if (!claimPastDueBannerHost(ownership)) return;
  host.value = createHost();
  placeHost();
  observer = new MutationObserver(placeHost);
  observer.observe(document.body, { childList: true, subtree: true });
  void loadWorkspaceAccess();
});

onBeforeUnmount(() => {
  if (!host.value) return;
  observer?.disconnect();
  observer = null;
  host.value?.remove();
  host.value = null;
  releasePastDueBannerHost(ownership);
});
</script>

<template>
  <Teleport v-if="host && isVisible" :to="host">
    <DmsSaasPastDueBanner />
  </Teleport>
</template>
