import { describe, expect, it } from "vitest";
import { SaasDashboardController } from "../src/routes/platformOwner/dashboard";
import { SaasWorkspaceDetailController } from "../src/routes/platformOwner/workspace-detail";
import { SaasWorkspacesAdminController } from "../src/routes/platformOwner/workspaces-admin";
import { useDmsAuth } from "./helpers/dms";
import { useMongoDatabase } from "./helpers/mongo";
import { ownerOnlyRoutes } from "./helpers/owner-only";

useMongoDatabase("workspace-routes-authorization");
useDmsAuth();

describe("back-office routes of the dashboard and the workspaces", () => {
  it("serve the dashboard to platform admins only", async () => {
    await expect(ownerOnlyRoutes(SaasDashboardController)).resolves.toEqual([
      "activity",
      "attention",
      "churn",
      "headline",
      "paidInvoices",
      "plansByMrr",
      "workspacesByStatus",
    ]);
  });

  it("serve a workspace's detail to platform admins only", async () => {
    await expect(
      ownerOnlyRoutes(SaasWorkspaceDetailController),
    ).resolves.toEqual([
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

  it("let only platform admins create workspaces and change their access", async () => {
    await expect(
      ownerOnlyRoutes(SaasWorkspacesAdminController),
    ).resolves.toEqual([
      "createWorkspace",
      "getComplimentaryImpact",
      "grantFreeAccess",
      "joinAsMember",
      "joinConfirmation",
      "lookUpOwnerEmail",
    ]);
  });
});
