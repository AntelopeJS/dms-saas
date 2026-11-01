import { readFileSync } from "node:fs";

const COMPONENTS_DIRECTORY = new URL(
  "../../frontend-vue/app/components/",
  import.meta.url,
);
/** Layout strips: shown on every page, above whatever the page renders. */
const LAYOUT_STRIPS = ["PastDueBanner.vue", "TrialEndingBanner.vue"];
const STRIPE_BACKED_READ = /use(BillingStatus|NextInvoice)\(([^)]*)\)/g;
const BROWSER_ONLY_READ = "{ server: false }";
const DEFERRED_PORTAL_BUTTON = /<DmsSaasCustomerPortalButton[^>]*is-deferred/;
const PRICING_COMPONENT = "Pricing.vue";

function component(file: string): string {
  return readFileSync(new URL(file, COMPONENTS_DIRECTORY), "utf8");
}

function stripFailures(file: string): string[] {
  const source = component(file);
  const reads = [...source.matchAll(STRIPE_BACKED_READ)];
  return [
    ...(reads.length === 0 ? [`${file} reads no billing status`] : []),
    ...reads
      .filter(([, , options]) => options !== BROWSER_ONLY_READ)
      .map(([read]) => `${file}: ${read} must pass ${BROWSER_ONLY_READ}`),
    ...(DEFERRED_PORTAL_BUTTON.test(source)
      ? []
      : [`${file}: DmsSaasCustomerPortalButton must be is-deferred`]),
  ];
}

/**
 * Where a server render may wait on a read. A layout strip never holds a page
 * on Stripe: its billing status and next invoice are read by the browser, and
 * its portal button opens the session only when clicked. The public pricing
 * page is the opposite: its plans are its content, read with the server
 * render through `usePublicPricing`, never again after mount.
 */
export function serverRenderedReadFailures(): string[] {
  const pricing = component(PRICING_COMPONENT);
  return [
    ...LAYOUT_STRIPS.flatMap(stripFailures),
    ...(pricing.includes("usePublicPricing()")
      ? []
      : [`${PRICING_COMPONENT} must read its plans with usePublicPricing()`]),
    ...["usePublicFetch", "onMounted("]
      .filter((call) => pricing.includes(call))
      .map(
        (call) => `${PRICING_COMPONENT} must not read after mount (${call})`,
      ),
  ];
}
