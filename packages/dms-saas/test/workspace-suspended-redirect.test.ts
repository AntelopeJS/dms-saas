import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  suspendedScreenRedirect,
  type WorkspaceAccess,
} from "../frontend-vue/app/composables/useWorkspaceAccessCache";

const SUSPENDED_PATH = "/workspace-suspended";

const harness = vi.hoisted(() => ({
  loggedIn: true,
  fetchAccess: vi.fn<() => Promise<WorkspaceAccess>>(),
}));

interface ValueRef<T> {
  value: T;
}

function ref<T>(value: T): ValueRef<T> {
  return { value };
}

function access(blocked: boolean): WorkspaceAccess {
  return { blocked, isTenantOwner: true, unpaidInvoice: null };
}

beforeEach(() => {
  harness.loggedIn = true;
  harness.fetchAccess.mockReset();
  harness.fetchAccess.mockResolvedValue(access(true));
  const state = ref<unknown>(null);
  vi.stubGlobal("useDmsState", () => state);
  vi.stubGlobal("useUserSession", () => ({
    loggedIn: ref(harness.loggedIn),
    session: ref({ activeTenantId: "tenant-a" }),
  }));
  vi.stubGlobal("useAuthFetch", () => ({ $authFetch: harness.fetchAccess }));
});

afterEach(() => vi.unstubAllGlobals());

describe("suspended screen redirect", () => {
  it("sends a member of a blocked workspace to the suspended screen", async () => {
    expect(await suspendedScreenRedirect("/cloud/projects")).toBe(
      SUSPENDED_PATH,
    );
  });

  it("leaves an active workspace where it is", async () => {
    harness.fetchAccess.mockResolvedValue(access(false));
    expect(await suspendedScreenRedirect("/cloud/projects")).toBeUndefined();
  });

  it.each([SUSPENDED_PATH, "/settings/workspace/billing", "/auth/login"])(
    "keeps the recovery surface %s reachable without asking",
    async (path) => {
      expect(await suspendedScreenRedirect(path)).toBeUndefined();
      expect(harness.fetchAccess).not.toHaveBeenCalled();
    },
  );

  it("does not ask for a signed-out visitor", async () => {
    harness.loggedIn = false;
    expect(await suspendedScreenRedirect("/cloud/projects")).toBeUndefined();
    expect(harness.fetchAccess).not.toHaveBeenCalled();
  });

  it("fails open when the access cannot be read", async () => {
    harness.fetchAccess.mockRejectedValue(new Error("offline"));
    expect(await suspendedScreenRedirect("/cloud/projects")).toBeUndefined();
  });

  it("reads the access once per workspace", async () => {
    await suspendedScreenRedirect("/cloud/projects");
    await suspendedScreenRedirect("/settings/user/members");
    expect(harness.fetchAccess).toHaveBeenCalledTimes(1);
  });
});
