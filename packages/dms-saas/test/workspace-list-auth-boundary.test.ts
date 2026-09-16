import { afterEach, describe, expect, it, vi } from "vitest";
import { useMyWorkspaces } from "../frontend-vue/app/composables/useMyWorkspaces";

interface TestRef<T> {
  value: T;
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

function setupWorkspaceList(
  isLoggedIn: boolean,
  authFetch: ReturnType<typeof vi.fn>,
) {
  const states = new Map<string, TestRef<unknown>>();
  vi.stubGlobal("useUserSession", () => ({
    loggedIn: { value: isLoggedIn },
  }));
  vi.stubGlobal("useAuthFetch", () => ({ $authFetch: authFetch }));
  vi.stubGlobal("useDmsState", (key: string, init: () => unknown) => {
    if (!states.has(key)) states.set(key, { value: init() });
    return states.get(key);
  });
  return useMyWorkspaces();
}

afterEach(() => vi.unstubAllGlobals());

describe("workspace list authentication boundary", () => {
  it("does not request user workspaces from an anonymous public layout", async () => {
    const authFetch = vi.fn();
    const workspaceList = setupWorkspaceList(false, authFetch);

    await workspaceList.refresh();

    expect(authFetch).not.toHaveBeenCalled();
    expect(workspaceList.workspaces.value).toEqual([]);
    expect(workspaceList.isLoaded.value).toBe(true);
  });

  it("loads user workspaces from an authenticated private page", async () => {
    const authFetch = vi.fn().mockResolvedValue([WORKSPACE_FIXTURE]);
    const workspaceList = setupWorkspaceList(true, authFetch);

    await workspaceList.refresh();

    expect(authFetch).toHaveBeenCalledWith("/api/saas/workspaces/mine");
    expect(workspaceList.workspaces.value).toEqual([WORKSPACE_FIXTURE]);
  });

  it("keeps expired-session handling inside authenticated fetch", async () => {
    const expiredSession = new Error("Session expired");
    const authFetch = vi.fn().mockRejectedValue(expiredSession);
    const workspaceList = setupWorkspaceList(true, authFetch);

    await expect(workspaceList.refresh()).rejects.toBe(expiredSession);
    expect(authFetch).toHaveBeenCalledWith("/api/saas/workspaces/mine");
  });
});
