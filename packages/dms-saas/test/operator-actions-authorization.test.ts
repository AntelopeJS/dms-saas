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
  getWorkspaceOperatorOptions: vi.fn(),
  grantBalanceCreditCommand: vi.fn(),
  manuallyUpgradeWorkspaceCommand: vi.fn(),
  operatorActorOf: vi.fn(),
  reactivateWorkspaceCommand: vi.fn(),
  suspendWorkspaceCommand: vi.fn(),
}));

import { SaasWorkspaceOperatorActionsController } from "../src/routes/platformOwner/workspace-operator-actions";

describe("platform-owner operation authorization", () => {
  it("requires platform-owner authentication on every operation route", () => {
    expect(SaasWorkspaceOperatorActionsController).toBeTypeOf("function");
    expect([...new Set(ownerAuthorization.methods)].sort()).toEqual([
      "getOperation",
      "getOptions",
      "getProvisioningAttempt",
      "getProvisioningAttempts",
      "grantCredit",
      "suspend",
      "unsuspend",
      "upgrade",
    ]);
  });
});
