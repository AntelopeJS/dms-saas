import { afterEach, describe, expect, it, vi } from "vitest";
import { useBillingStatus } from "../frontend-vue/app/composables/useBillingStatus";
import { useMountedData } from "../frontend-vue/app/composables/useMountedData";
import { useNextInvoice } from "../frontend-vue/app/composables/useNextInvoice";
import type { ApiDataRequest, UseApiDataOptions } from "./helpers/api-data";
import { mountComposable, ref } from "./helpers/frontend-vue";

interface ApiDataCall {
  url: ApiDataRequest;
  options: UseApiDataOptions<unknown> | undefined;
}

function stubApiData(): ApiDataCall[] {
  const calls: ApiDataCall[] = [];
  vi.stubGlobal(
    "useApiData",
    (url: ApiDataRequest, options?: UseApiDataOptions<unknown>) => {
      calls.push({ url, options });
      return { data: { value: null } };
    },
  );
  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
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
    const data = ref<{ status: string } | null>({ status: "past_due" });

    const strip = mountComposable(
      () => useMountedData(data),
      (shown) => shown.value,
    );

    expect(strip.renders[0]).toBeNull();
    expect(strip.state.value).toEqual({ status: "past_due" });
    data.value = null;
    expect(strip.state.value).toBeNull();
    strip.unmount();
  });
});
