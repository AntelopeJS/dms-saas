import { describe, expect, it, vi } from "vitest";

const ownerAuthorization = vi.hoisted(() => ({ methods: [] as string[] }));

vi.mock("@antelopejs/interface-dms/auth", () => ({
  AuthOwnerOnly:
    () =>
    (_target: object, propertyKey: string | symbol | undefined): void => {
      if (propertyKey) ownerAuthorization.methods.push(String(propertyKey));
    },
}));

vi.mock("@antelopejs/interface-database-decorators", async (importOriginal) => {
  const original =
    await importOriginal<
      typeof import("@antelopejs/interface-database-decorators")
    >();
  return { ...original, Model: () => (): void => undefined };
});

vi.mock("@antelopejs/interface-dms/db", () => ({
  TenantModel: class TenantModel {},
}));

vi.mock("../src/operator-actions", () => ({
  copyInvitationLinkCommand: vi.fn(),
  operatorActorOf: vi.fn(),
  resendInvitationCommand: vi.fn(),
}));

import { SaasWorkspaceInvitationsController } from "../src/routes/platformOwner/workspace-invitations";

describe("back-office invitation authorization", () => {
  it("restricts copying and resending invitation links to platform owners", () => {
    expect(SaasWorkspaceInvitationsController).toBeTypeOf("function");
    expect([...new Set(ownerAuthorization.methods)].sort()).toEqual([
      "copyLink",
      "resend",
    ]);
  });
});
