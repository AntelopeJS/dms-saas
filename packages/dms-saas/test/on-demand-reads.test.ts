import { afterEach, describe, expect, it, vi } from "vitest";
import { useBillingStatus } from "../frontend-vue/app/composables/useBillingStatus";
import { useOnDemandRead } from "../frontend-vue/app/composables/useOnDemandRead";
import { useSeatQuota } from "../frontend-vue/app/composables/useSeatQuota";
import { useTenantPlan } from "../frontend-vue/app/composables/useTenantPlan";

interface Holder<T> {
  value: T;
}

/** A `useApiData(url, options)` call, as the stub records it. */
interface ApiDataCall {
  url: () => string | null | undefined;
  options: Record<string, unknown> | undefined;
  data: Holder<unknown>;
  status: Holder<string>;
  error: Holder<unknown>;
  pending: Holder<boolean>;
  execute: ReturnType<typeof vi.fn>;
}

function stubApiData(answer: (call: ApiDataCall) => void): ApiDataCall[] {
  const calls: ApiDataCall[] = [];
  vi.stubGlobal(
    "useApiData",
    (url: ApiDataCall["url"], options?: Record<string, unknown>) => {
      const call: ApiDataCall = {
        url: typeof url === "function" ? url : () => url,
        options,
        data: { value: null },
        status: { value: "idle" },
        error: { value: null },
        pending: { value: false },
        execute: vi.fn(async () => answer(call)),
      };
      calls.push(call);
      return call;
    },
  );
  return calls;
}

afterEach(() => vi.unstubAllGlobals());

describe("useOnDemandRead", () => {
  it("reads through useApiData in the browser, only when asked, outside the page's refreshes", async () => {
    const calls = stubApiData((call) => {
      call.data.value = { url: call.url() };
      call.status.value = "success";
    });
    const email = { value: "a@example.com" };
    const lookup = useOnDemandRead<{ url: string }>(() => "/api/lookup", {
      query: () => ({ email: email.value }),
    });

    const [call] = calls;
    expect(call!.options).toMatchObject({
      immediate: false,
      server: false,
      watch: false,
      refreshOnPageRefresh: false,
    });
    expect(call!.execute).not.toHaveBeenCalled();
    expect((call!.options!.query as () => unknown)()).toEqual({
      email: "a@example.com",
    });

    await expect(lookup.read()).resolves.toEqual({ url: "/api/lookup" });
    await lookup.read();
    expect(call!.execute).toHaveBeenCalledTimes(2);
  });

  it("rejects with the failure of the read", async () => {
    const failure = { statusCode: 502 };
    stubApiData((call) => {
      call.error.value = failure;
      call.status.value = "error";
    });
    const read = useOnDemandRead(() => "/api/impact");
    await expect(read.read()).rejects.toBe(failure);
  });
});

describe("keys left to the DMS", () => {
  it("reads the workspace's data under its bare URL: the DMS scopes it per account and workspace", () => {
    const calls = stubApiData(() => undefined);
    useSeatQuota();
    useTenantPlan();
    useBillingStatus();
    expect(calls.map((call) => call.url())).toEqual([
      "/api/saas/tenant/seats",
      "/api/saas/tenant/plan",
      "/api/saas/billing/status",
    ]);
  });

  it("reads the seats again with the page and on each mount: no option holds them back", () => {
    const calls = stubApiData(() => undefined);
    useSeatQuota();
    expect(calls[0]!.options).toBeUndefined();
  });
});
