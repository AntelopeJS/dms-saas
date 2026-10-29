import { describe, expect, it } from "vitest";
import { SaasWorkspaceInvitationsController } from "../src/routes/platformOwner/workspace-invitations";
import { useDmsAuth } from "./helpers/dms";
import { useMongoDatabase } from "./helpers/mongo";
import { ownerOnlyRoutes } from "./helpers/owner-only";

useMongoDatabase("workspace-invitations-authorization");
useDmsAuth();

describe("back-office invitation authorization", () => {
  it("restricts copying, resending and revoking invitations to platform owners", async () => {
    await expect(
      ownerOnlyRoutes(SaasWorkspaceInvitationsController),
    ).resolves.toEqual(["copyLink", "resend", "revoke"]);
  });
});
