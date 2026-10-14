import { afterEach, describe, expect, it, vi } from "vitest";
import { useMyWorkspaces } from "../frontend-vue/app/composables/useMyWorkspaces";

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

interface WorkspaceFixture {
  _id: string;
  name: string;
  planName: string | null;
  isCurrent: boolean;
}

const WORKSPACE_FIXTURE: WorkspaceFixture = {
  _id: "workspace-1",
  name: "Workspace",
  planName: "Free",
  isCurrent: true,
};

/** What `useApiData` was asked to read, and the refs it hands back. */
interface ApiDataCall {
  url: unknown;
  data: Holder<unknown>;
  status: Holder<string>;
  error: Holder<unknown>;
  refresh: ReturnType<typeof vi.fn>;
}

function setupWorkspaceList(isLoggedIn: boolean) {
  const loggedIn = holder(isLoggedIn);
  const calls: ApiDataCall[] = [];
  vi.stubGlobal("useUserSession", () => ({ loggedIn }));
  vi.stubGlobal("useApiData", (url: unknown) => {
    const call: ApiDataCall = {
      url,
      data: holder(null),
      status: holder(read(url) ? "pending" : "idle"),
      error: holder(null),
      refresh: vi.fn(async () => undefined),
    };
    calls.push(call);
    return call;
  });
  return { list: useMyWorkspaces(), calls, loggedIn };
}

afterEach(() => vi.unstubAllGlobals());

describe("workspace list authentication boundary", () => {
  it("does not request user workspaces from an anonymous public layout", () => {
    const { list, calls } = setupWorkspaceList(false);

    expect(calls).toHaveLength(1);
    expect(read(calls[0]!.url)).toBeNull();
    expect(list.workspaces.value).toEqual([]);
    expect(list.isLoaded.value).toBe(true);
  });

  it("reads user workspaces on an authenticated page, through useApiData", () => {
    const { list, calls, loggedIn } = setupWorkspaceList(true);
    const call = calls[0]!;

    expect(read(call.url)).toBe("/api/saas/workspaces/mine");
    expect(list.isLoaded.value).toBe(false);

    call.data.value = [WORKSPACE_FIXTURE];
    call.status.value = "success";
    expect(list.workspaces.value).toEqual([WORKSPACE_FIXTURE]);
    expect(list.isLoaded.value).toBe(true);

    // Signing out leaves nothing to read.
    loggedIn.value = false;
    expect(read(call.url)).toBeNull();
  });

  it("keeps the entries on screen when a later read fails", () => {
    const { list, calls } = setupWorkspaceList(true);
    const call = calls[0]!;
    call.data.value = [WORKSPACE_FIXTURE];
    call.status.value = "error";
    call.error.value = new Error("Session expired");

    expect(list.hasFailed.value).toBe(true);
    expect(list.isLoaded.value).toBe(true);
    expect(list.workspaces.value).toEqual([WORKSPACE_FIXTURE]);
  });
});
