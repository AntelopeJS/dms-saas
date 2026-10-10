import { describe, expect, it, vi } from "vitest";

const store = vi.hoisted(() => ({
  deletedInvites: [] as string[],
  completed: [] as string[],
}));

vi.mock("@antelopejs/interface-database-decorators", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@antelopejs/interface-database-decorators")
    >();
  const fakes: Record<string, () => unknown> = {
    TenantSubscriptionModel: () => ({
      findOne: async () => ({
        _id: "acme",
        status: "active",
        stripeSubscriptionId: null,
      }),
      beginTransition: async () => undefined,
      completeTransition: async (id: string) => {
        store.completed.push(id);
      },
    }),
    UserInviteModel: () => ({
      getAll: async () => [{ _id: "invite-1" }, { _id: "invite-2" }],
      delete: async (id: string) => {
        store.deletedInvites.push(id);
        return 1;
      },
    }),
    BillingSettingsModel: () => ({ get: async () => undefined }),
  };
  return {
    ...actual,
    GetModel: (model: { name: string }) => fakes[model.name]?.(),
  };
});

vi.mock("../src/billing-state", () => ({
  recomputeTenantBillingState: async () => undefined,
}));

vi.mock("../src/notifications", () => ({
  notifyTenantOwners: async () => undefined,
  subscriptionCancelledSubject: "cancelled",
}));

vi.mock("../src/stripe", () => ({ getStripeClient: () => ({}) }));

const { requestWorkspaceDeletion } = await import("../src/workspaces/deletion");

describe("workspace deletion", () => {
  it("cancels the pending invitations, as the confirmation announces", async () => {
    await expect(requestWorkspaceDeletion("acme")).resolves.toEqual({
      status: "cancelled",
      retentionDays: 30,
    });

    expect(store.completed).toEqual(["acme"]);
    expect(store.deletedInvites).toEqual(["invite-1", "invite-2"]);
  });
});
