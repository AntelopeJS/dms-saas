import { describe, expect, it, vi } from "vitest";

const ownerAuthorization = vi.hoisted(() => ({ routes: [] as string[] }));

vi.mock("@antelopejs/interface-dms/auth", () => ({
  AuthOwnerOnly:
    () =>
    (target: object, propertyKey: string | symbol | undefined): void => {
      if (!propertyKey) return;
      ownerAuthorization.routes.push(
        `${target.constructor.name}.${String(propertyKey)}`,
      );
    },
}));

vi.mock("@antelopejs/interface-database-decorators", async (importOriginal) => {
  const original =
    await importOriginal<
      typeof import("@antelopejs/interface-database-decorators")
    >();
  return { ...original, Model: () => (): void => undefined };
});

import { SaasDashboardController } from "../src/routes/platformOwner/dashboard";
import { SaasWorkspaceDetailController } from "../src/routes/platformOwner/workspace-detail";
import { SaasWorkspacesAdminController } from "../src/routes/platformOwner/workspaces-admin";

function routesOf(controller: { name: string }): string[] {
  return [
    ...new Set(
      ownerAuthorization.routes
        .filter((route) => route.startsWith(`${controller.name}.`))
        .map((route) => route.slice(controller.name.length + 1)),
    ),
  ].sort();
}

describe("back-office routes of the dashboard and the workspaces", () => {
  it("serve the dashboard to platform admins only", () => {
    expect(routesOf(SaasDashboardController)).toEqual([
      "activity",
      "attention",
      "churn",
      "headline",
      "paidInvoices",
      "plansByMrr",
      "workspacesByStatus",
    ]);
  });

  it("serve a workspace's detail to platform admins only", () => {
    expect(routesOf(SaasWorkspaceDetailController)).toEqual([
      "activity",
      "availableCredit",
      "billingInfo",
      "directoryHeadline",
      "facts",
      "overview",
      "subscriptionTimeline",
      "tabCounts",
    ]);
  });

  it("let only platform admins create workspaces and change their access", () => {
    expect(routesOf(SaasWorkspacesAdminController)).toEqual([
      "createWorkspace",
      "getComplimentaryImpact",
      "grantFreeAccess",
      "joinAsMember",
      "joinConfirmation",
      "lookUpOwnerEmail",
    ]);
  });
});
