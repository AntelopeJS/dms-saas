import { describe, expect, it, vi } from "vitest";

type Listener = (payload: Record<string, unknown>) => unknown;

const doubles = vi.hoisted(() => ({
  listeners: new Map<string, Listener>(),
  recompute: vi.fn(async () => undefined),
}));

vi.mock("@antelopejs/interface-dms/hooks", () => ({
  Hook: {
    MEMBER_ADDED: "member:added",
    MEMBER_REMOVED: "member:removed",
    INVITE_CREATED: "invite:created",
    INVITE_DELETED: "invite:deleted",
  },
  RegisterHook: (hook: string, listener: Listener) =>
    doubles.listeners.set(hook, listener),
}));

vi.mock("../src/billing-state/index", () => ({
  recomputeTenantBillingState: doubles.recompute,
}));

const { registerWorkspaceDirectoryHooks } =
  await import("../src/billing-state/directory-hooks");

registerWorkspaceDirectoryHooks();

function fire(hook: string, payload: Record<string, unknown>): void {
  doubles.listeners.get(hook)?.(payload);
}

describe("workspace directory hooks", () => {
  it("leaves out the members being removed, at once", () => {
    fire("member:removed", { tenantId: "acme", userIds: ["u1"] });
    expect(doubles.recompute).toHaveBeenLastCalledWith("acme", {
      userIds: ["u1"],
    });
  });

  it("releases the seat of a cancelled invitation, not of a resent one", () => {
    fire("invite:deleted", {
      tenantId: "acme",
      email: "a@b.c",
      reason: "cancelled",
    });
    expect(doubles.recompute).toHaveBeenLastCalledWith("acme", {
      inviteeEmail: "a@b.c",
    });
    fire("invite:deleted", {
      tenantId: "acme",
      email: "a@b.c",
      reason: "resent",
    });
    expect(doubles.recompute).toHaveBeenLastCalledWith("acme", {});
  });
});
