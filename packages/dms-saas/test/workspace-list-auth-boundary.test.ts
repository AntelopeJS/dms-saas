import { afterEach, describe, expect, it, vi } from "vitest";
import { useMyWorkspaces } from "../frontend-vue/app/composables/useMyWorkspaces";
import {
  type MaybeRefOrGetter,
  type Ref,
  ref,
  toValue,
} from "./helpers/frontend-vue";

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
  url: MaybeRefOrGetter<string | null>;
  data: Ref<WorkspaceFixture[] | null>;
  status: Ref<string>;
  error: Ref<Error | null>;
  refresh: ReturnType<typeof vi.fn>;
}

function setupWorkspaceList(isLoggedIn: boolean) {
  const loggedIn = ref(isLoggedIn);
  const calls: ApiDataCall[] = [];
  vi.stubGlobal("useDmsUserSession", () => ({ loggedIn }));
  vi.stubGlobal("useApiData", (url: ApiDataCall["url"]) => {
    const call: ApiDataCall = {
      url,
      data: ref(null),
      status: ref(toValue(url) ? "pending" : "idle"),
      error: ref(null),
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
    expect(toValue(calls[0]!.url)).toBeNull();
    expect(list.workspaces.value).toEqual([]);
    expect(list.isLoaded.value).toBe(true);
  });

  it("reads user workspaces on an authenticated page, through useApiData", () => {
    const { list, calls, loggedIn } = setupWorkspaceList(true);
    const call = calls[0]!;

    expect(toValue(call.url)).toBe("/api/saas/workspaces/mine");
    expect(list.isLoaded.value).toBe(false);

    call.data.value = [WORKSPACE_FIXTURE];
    call.status.value = "success";
    expect(list.workspaces.value).toEqual([WORKSPACE_FIXTURE]);
    expect(list.isLoaded.value).toBe(true);

    loggedIn.value = false;
    expect(toValue(call.url)).toBeNull();
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

  it("does not show a retry as failed while it runs", () => {
    const { list, calls } = setupWorkspaceList(true);
    const call = calls[0]!;
    call.status.value = "error";
    call.error.value = new Error("Bad gateway");
    expect(list.hasFailed.value).toBe(true);

    call.status.value = "pending";
    expect(list.hasFailed.value).toBe(false);
    expect(list.isLoaded.value).toBe(false);
  });
});
