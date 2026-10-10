import type { User } from "@antelopejs/interface-dms/auth/db";
import { beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({ steps: [] as string[] }));

vi.mock(
  "@antelopejs/interface-database-decorators",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("@antelopejs/interface-database-decorators")
    >()),
    GetModel: () => ({
      insert: async (rows: Array<{ name?: string; planId?: string }>) => {
        harness.steps.push(rows[0]?.planId ? "subscription" : "tenant");
        return ["tenant-new"];
      },
    }),
  }),
);
vi.mock("@antelopejs/interface-dms/invites", () => ({
  INVITE_EXPIRY_DAYS: 7,
  inviteUserToTenant: async () => {
    harness.steps.push("owner");
    return { kind: "invited", token: "invite-token" };
  },
}));
vi.mock("../src/billing-state", () => ({
  recomputeTenantBillingState: async () => {
    harness.steps.push("billing state");
  },
}));
vi.mock("../src/workspaces/invitations", () => ({
  inviterNameOf: () => "Camille Laurent",
  deliverInvitationEmail: async () => {
    harness.steps.push("email");
    return "failed";
  },
}));

const { createWorkspaceForOwner } =
  await import("../src/workspaces/operator-creation");

const OPERATOR = { _id: "operator", language: "en" } as User;

beforeEach(() => {
  harness.steps = [];
});

describe("operator workspace creation", () => {
  // A mail server that takes minutes to time out left the workspace listed as
  // free, with no plan, until the invitation e-mail gave up.
  it("writes the plan before it e-mails the owner", async () => {
    const created = await createWorkspaceForOwner(
      {
        name: "Recette Op Co",
        planId: "pro",
        ownerEmail: "owner@example.com",
        access: "owner_pays",
        freeUntil: null,
      },
      OPERATOR,
    );

    expect(harness.steps).toEqual([
      "tenant",
      "owner",
      "subscription",
      "billing state",
      "email",
    ]);
    expect(created).toMatchObject({
      tenantId: "tenant-new",
      invitationEmail: "failed",
      access: "owner_pays",
    });
  });
});
