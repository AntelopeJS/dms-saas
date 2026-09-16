import { describe, expect, it, vi } from "vitest";

const authorization = vi.hoisted(() => ({
  ownerMethods: [] as string[],
  tenantMethods: [] as string[],
}));

vi.mock("@antelopejs/interface-dms/auth", () => ({
  AuthOwnerOnly:
    () =>
    (_target: object, propertyKey: string | symbol | undefined): void => {
      if (propertyKey) authorization.ownerMethods.push(String(propertyKey));
    },
}));

vi.mock("@antelopejs/interface-dms/guards", () => ({
  AuthTenantMember:
    () =>
    (_target: object, propertyKey: string | symbol | undefined): void => {
      if (propertyKey) authorization.tenantMethods.push(String(propertyKey));
    },
}));

vi.mock("@antelopejs/interface-file-storage", () => ({
  PromoteFile: vi.fn(),
  MoveFile: vi.fn(),
  isStagedKey: vi.fn(),
  stripStagingPrefix: vi.fn(),
  GetFileMetadata: vi.fn(),
  CreateReadUrl: vi.fn(),
}));

import { SaasPlatformSupportController } from "../src/routes/platformOwner/support";
import { SaasTenantSupportController } from "../src/routes/tenant/support";

describe("support route authorization", () => {
  it("requires tenant membership for every tenant operation", () => {
    expect(SaasTenantSupportController).toBeTypeOf("function");
    expect([...new Set(authorization.tenantMethods)].sort()).toEqual([
      "attachment",
      "config",
      "create",
      "detail",
      "reply",
      "upload",
    ]);
  });

  it("requires platform ownership for every global operation", () => {
    expect(SaasPlatformSupportController).toBeTypeOf("function");
    expect([...new Set(authorization.ownerMethods)].sort()).toEqual([
      "attachment",
      "detail",
      "reconcile",
      "reply",
      "update",
    ]);
  });
});
