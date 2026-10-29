import { describe, expect, it } from "vitest";
import { SaasWorkspaceOperatorActionsController } from "../src/routes/platformOwner/workspace-operator-actions";
import { useDmsAuth } from "./helpers/dms";
import { useMongoDatabase } from "./helpers/mongo";
import { ownerOnlyRoutes } from "./helpers/owner-only";

useMongoDatabase("operator-actions-authorization");
useDmsAuth();

describe("platform-owner operation authorization", () => {
  it("requires platform-owner authentication on every operation route", async () => {
    await expect(
      ownerOnlyRoutes(SaasWorkspaceOperatorActionsController),
    ).resolves.toEqual([
      "getOperation",
      "getOptions",
      "getProvisioningAttempt",
      "getProvisioningAttempts",
      "getSuspensionImpact",
      "getUpgradePreview",
      "grantCredit",
      "suspend",
      "unsuspend",
      "upgrade",
    ]);
  });
});
