import { afterEach, describe, expect, it, vi } from "vitest";
import { useSegmentCatalog } from "../frontend-vue/app/build/segments/useSegmentCatalog";
import { useUserDetail } from "../frontend-vue/app/build/users/useUserDetail";
import { useWorkspaceOverview } from "../frontend-vue/app/build/workspace-detail/useWorkspaceOverview";
import { useExportHistory } from "../frontend-vue/app/composables/useExportHistory";
import { useOnDemandRead } from "../frontend-vue/app/composables/useOnDemandRead";
import { ref } from "./helpers/frontend-vue";

interface Holder<T> {
  value: T;
}

/** A source as `useApiData` reads it: a getter, a holder or a plain value. */
function read<T>(source: unknown): T {
  if (typeof source === "function") return (source as () => T)();
  if (source && typeof source === "object" && "value" in source)
    return (source as Holder<T>).value;
  return source as T;
}

type Handler = (context: {
  $authFetch: (url: string, options?: unknown) => Promise<unknown>;
  signal: AbortSignal;
}) => Promise<unknown>;

/** A `useApiData` call: what it reads, and the refs it hands back. */
interface ApiDataCall {
  source: unknown;
  handler?: Handler;
  options?: Record<string, unknown>;
  data: Holder<unknown>;
  status: Holder<string>;
  error: Holder<unknown>;
  pending: Holder<boolean>;
  refresh: ReturnType<typeof vi.fn>;
  execute: ReturnType<typeof vi.fn>;
}

function stubApiData(): ApiDataCall[] {
  const calls: ApiDataCall[] = [];
  vi.stubGlobal(
    "useApiData",
    (source: unknown, second?: unknown, third?: unknown) => {
      const call: ApiDataCall = {
        source,
        handler: typeof second === "function" ? (second as Handler) : undefined,
        options: (typeof second === "function" ? third : second) as
          | Record<string, unknown>
          | undefined,
        data: ref(null),
        status: ref("idle"),
        error: ref(null),
        pending: ref(false),
        refresh: vi.fn(async () => undefined),
        execute: vi.fn(async () => undefined),
      };
      calls.push(call);
      return call;
    },
  );
  vi.stubGlobal("useOnDemandRead", useOnDemandRead);
  return calls;
}

afterEach(() => vi.unstubAllGlobals());

describe("readers on useApiData", () => {
  it("reads the user a route names, and moves with the route", () => {
    const calls = stubApiData();
    const params = ref<Record<string, string>>({ id: "u1" });

    const detail = useUserDetail(() => params.value);

    expect(read(calls[0]!.source)).toBe("/api/saas/users/u1");
    params.value = { id: "u2" };
    expect(read(calls[0]!.source)).toBe("/api/saas/users/u2");
    expect(detail.userId.value).toBe("u2");
    params.value = {};
    expect(read(calls[0]!.source)).toBeNull();
  });

  it("shares one operator overview read, which the page's refreshes read again", () => {
    const calls = stubApiData();
    const subscribe = vi.fn();
    vi.stubGlobal("usePageLiveRefresh", subscribe);

    const state = useWorkspaceOverview("t1");
    expect(read(calls[0]!.source)).toBe("/api/saas/workspaces/t1/overview");
    expect(state.isLoading.value).toBe(true);
    expect(calls[0]!.options).toBeUndefined();
    expect(subscribe).not.toHaveBeenCalled();

    useWorkspaceOverview("");
    expect(read(calls[1]!.source)).toBeNull();
  });

  it("keeps the export card on the newest page and falls back from an emptied one", async () => {
    const calls = stubApiData();
    vi.stubGlobal("useAuthFetch", () => ({ $authFetch: vi.fn() }));
    vi.stubGlobal("useDmsState", (_key: string, init: () => unknown) =>
      ref(init()),
    );

    const history = useExportHistory();
    const [newest, shown] = calls;
    expect(read(newest!.source)).toBe("saas-export-history:1");
    expect(read(shown!.source)).toBe("saas-export-history:1");

    history.goToPage(3);
    expect(read(newest!.source)).toBe("saas-export-history:1");
    expect(read(shown!.source)).toBe("saas-export-history:3");

    const pages: unknown[] = [];
    const $authFetch = vi.fn(
      async (_url: string, options?: { query?: { page: number } }) => {
        pages.push(options?.query?.page);
        return options?.query?.page === 1
          ? { items: [{ jobId: "j1" }], hasMore: true, page: 1, pageSize: 10 }
          : { items: [], hasMore: false, page: 3, pageSize: 10 };
      },
    );
    const signal = new AbortController().signal;
    const result = await shown!.handler!({ $authFetch, signal });

    expect(pages).toEqual([3, 1]);
    expect(result).toMatchObject({ page: 1, items: [{ jobId: "j1" }] });
  });

  it("keeps an export starting until the page shows it", async () => {
    stubApiData();
    vi.stubGlobal("useAuthFetch", () => ({
      $authFetch: vi.fn(async () => undefined),
    }));
    vi.stubGlobal("useDmsState", (_key: string, init: () => unknown) =>
      ref(init()),
    );
    let finishRefresh: () => void = () => undefined;
    const refreshPageBlocks = vi.fn(
      () => new Promise<void>((resolve) => (finishRefresh = resolve)),
    );
    vi.stubGlobal("refreshPageBlocks", refreshPageBlocks);

    const history = useExportHistory();
    const started = history.start();
    await vi.waitFor(() => expect(refreshPageBlocks).toHaveBeenCalledTimes(1));
    expect(history.state.value.isStarting).toBe(true);
    finishRefresh();
    await started;
    expect(history.state.value.isStarting).toBe(false);
  });

  it("shows a retry as loading, not as the failure it retries", () => {
    const calls = stubApiData();
    vi.stubGlobal("usePageLiveRefresh", () => undefined);
    vi.stubGlobal("useAuthFetch", () => ({ $authFetch: vi.fn() }));
    vi.stubGlobal("useDmsState", (_key: string, init: () => unknown) =>
      ref(init()),
    );

    const detail = useUserDetail(() => ({ id: "u1" }));
    const catalog = useSegmentCatalog();
    const overview = useWorkspaceOverview("t1");
    const history = useExportHistory();
    const failure = new Error("Bad gateway");
    for (const call of calls) {
      call.status.value = "error";
      call.error.value = failure;
    }
    expect(detail.isLoading.value).toBe(false);
    expect(catalog.isLoading.value).toBe(false);
    expect(overview.hasError.value).toBe(true);
    expect(history.state.value.hasFailed).toBe(true);

    for (const call of calls) {
      call.status.value = "pending";
      call.pending.value = true;
    }
    expect(detail.isLoading.value).toBe(true);
    expect(catalog.isLoading.value).toBe(true);
    expect(overview.hasError.value).toBe(false);
    expect(overview.isLoading.value).toBe(true);
    expect(history.state.value.hasFailed).toBe(false);
  });
});
