import { afterEach, describe, expect, it, vi } from "vitest";
import { useBillingStatus } from "../frontend-vue/app/composables/useBillingStatus";
import { useMountedData } from "../frontend-vue/app/composables/useMountedData";
import { useNextInvoice } from "../frontend-vue/app/composables/useNextInvoice";

const lifecycle = vi.hoisted(() => ({ mounted: [] as Array<() => void> }));

// The composables' Vue, without reactivity: a computed reads its getter on
// each access, and mounting runs the hooks a setup registered.
vi.mock("../frontend-vue/node_modules/vue/index.mjs", () => ({
  computed: (get: () => unknown) => ({
    get value() {
      return get();
    },
  }),
  shallowRef: <T>(value: T) => ({ value }),
  onMounted: (hook: () => void) => lifecycle.mounted.push(hook),
}));

interface ApiDataCall {
  url: unknown;
  options: unknown;
}

function stubApiData(): ApiDataCall[] {
  const calls: ApiDataCall[] = [];
  vi.stubGlobal("useApiData", (url: unknown, options: unknown) => {
    calls.push({ url, options });
    return { data: { value: null } };
  });
  return calls;
}

function mount(): void {
  lifecycle.mounted.splice(0).forEach((hook) => hook());
}

afterEach(() => {
  vi.unstubAllGlobals();
  lifecycle.mounted.length = 0;
});

describe("Stripe-backed reads of the layout strips", () => {
  it("lets a strip leave the billing status and next invoice to the browser", () => {
    const calls = stubApiData();

    useBillingStatus({ server: false });
    useNextInvoice({ server: false });

    expect(calls).toEqual([
      { url: "/api/saas/billing/status", options: { server: false } },
      { url: "/api/saas/tenant/upcoming-invoice", options: { server: false } },
    ]);
  });

  it("keeps the billing page's own reads on the server", () => {
    const calls = stubApiData();

    useBillingStatus();
    useNextInvoice();

    expect(calls.map((call) => call.options)).toEqual([{}, {}]);
  });

  it("shows nothing before the strip is mounted, as the server rendered it", () => {
    const data = { value: { status: "past_due" } as { status: string } | null };
    const shown = useMountedData(data);

    expect(shown.value).toBeNull();
    mount();
    expect(shown.value).toEqual({ status: "past_due" });
    data.value = null;
    expect(shown.value).toBeNull();
  });
});
