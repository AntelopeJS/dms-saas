import { afterEach, describe, expect, it, vi } from "vitest";
import { useUserDetail } from "../frontend-vue/app/build/users/useUserDetail";
import { useWorkspaceOverview } from "../frontend-vue/app/build/workspace-detail/useWorkspaceOverview";
import { useExportHistory } from "../frontend-vue/app/composables/useExportHistory";

// The composables' Vue, without reactivity: a computed reads its getter on
// each access, so plain `{ value }` holders stand in for refs.
vi.mock("../frontend-vue/node_modules/vue/index.mjs", () => ({
  computed: (get: () => unknown) => ({
    get value() {
      return get();
    },
  }),
  ref: <T>(value: T) => ({ value }),
}));

interface Holder<T> {
  value: T;
}

const holder = <T>(value: T): Holder<T> => ({ value });

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
  data: Holder<unknown>;
  status: Holder<string>;
  error: Holder<unknown>;
  pending: Holder<boolean>;
  refresh: ReturnType<typeof vi.fn>;
}

function stubApiData(): ApiDataCall[] {
  const calls: ApiDataCall[] = [];
  vi.stubGlobal("useApiData", (source: unknown, second?: unknown) => {
    const call: ApiDataCall = {
      source,
      handler: typeof second === "function" ? (second as Handler) : undefined,
      data: holder(null),
      status: holder("idle"),
      error: holder(null),
      pending: holder(false),
      refresh: vi.fn(async () => undefined),
    };
    calls.push(call);
    return call;
  });
  return calls;
}

afterEach(() => vi.unstubAllGlobals());

describe("readers on useApiData", () => {
  it("reads the user a route names, and moves with the route", () => {
    const calls = stubApiData();
    const params = holder<Record<string, string>>({ id: "u1" });

    const detail = useUserDetail(() => params.value);

    expect(read(calls[0]!.source)).toBe("/api/saas/users/u1");
    params.value = { id: "u2" };
    expect(read(calls[0]!.source)).toBe("/api/saas/users/u2");
    expect(detail.userId.value).toBe("u2");
    params.value = {};
    expect(read(calls[0]!.source)).toBeNull();
  });

  it("shares one operator overview read, refreshed once per page refresh", () => {
    const calls = stubApiData();
    const subscriptions: Array<() => void> = [];
    vi.stubGlobal("usePageLiveRefresh", (refresh: () => void) => {
      subscriptions.push(refresh);
    });

    const state = useWorkspaceOverview("t1");
    expect(read(calls[0]!.source)).toBe("/api/saas/workspaces/t1/overview");
    expect(state.isLoading.value).toBe(true);

    subscriptions[0]!();
    expect(calls[0]!.refresh).toHaveBeenCalledWith({ dedupe: "defer" });

    useWorkspaceOverview("");
    expect(read(calls[1]!.source)).toBeNull();
  });

  it("keeps the export card on the newest page and falls back from an emptied one", async () => {
    const calls = stubApiData();
    vi.stubGlobal("useAuthFetch", () => ({ $authFetch: vi.fn() }));
    vi.stubGlobal("useDmsState", (_key: string, init: () => unknown) =>
      holder(init()),
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
});
