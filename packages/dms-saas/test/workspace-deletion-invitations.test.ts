import { randomUUID } from "node:crypto";
import { GetModel } from "@antelopejs/interface-database-decorators";
import { UserInviteModel } from "@antelopejs/interface-dms/db";
import { Hook, RegisterHook } from "@antelopejs/interface-dms/hooks";
import { describe, expect, it } from "vitest";
import { TenantSubscriptionModel } from "../src/db";
import { requestWorkspaceDeletion } from "../src/workspaces/deletion";
import { useMongoDatabase } from "./helpers/mongo";
import { ANY_DATE } from "./helpers/asymmetric-matchers";

useMongoDatabase("workspace-deletion-invitations");

const INVITATION_LIFETIME_MS = 86_400_000;

/** The invitations the DMS resolution deleted, with its reason, by workspace. */
const resolvedInvitations = new Map<
  string,
  { inviteId: string; reason: string }[]
>();

RegisterHook(Hook.INVITE_DELETED, async ({ tenantId, inviteId, reason }) => {
  const resolved = resolvedInvitations.get(tenantId) ?? [];
  resolved.push({ inviteId, reason });
  resolvedInvitations.set(tenantId, resolved);
  return undefined;
});

/** An active, card-less workspace with two pending invitations. */
async function workspaceWithInvitations(): Promise<string> {
  const tenantId = randomUUID();
  await GetModel(TenantSubscriptionModel, tenantId).insert({
    _id: tenantId,
    status: "active",
    stripeSubscriptionId: null,
  });
  const now = Date.now();
  await GetModel(UserInviteModel, tenantId).insert(
    ["invite-1", "invite-2"].map((_id) => ({
      _id,
      createdAt: new Date(now),
      email: `${_id}@example.test`,
      firstname: null,
      lastname: null,
      roles_ids: [],
      language: "en",
      token: randomUUID(),
      asTenantOwner: false,
      expiresAt: new Date(now + INVITATION_LIFETIME_MS),
      extensions: null,
    })),
  );
  return tenantId;
}

describe("workspace deletion", () => {
  it("cancels the pending invitations through the DMS, as the confirmation announces", async () => {
    const tenantId = await workspaceWithInvitations();

    await expect(requestWorkspaceDeletion(tenantId, "owner")).resolves.toEqual({
      status: "cancelled",
      retentionDays: 30,
    });

    await expect(
      GetModel(TenantSubscriptionModel, tenantId).findOne(),
    ).resolves.toMatchObject({ _id: tenantId, status: "cancelled" });
    await expect(GetModel(UserInviteModel, tenantId).getAll()).resolves.toEqual(
      [],
    );
    expect(resolvedInvitations.get(tenantId)).toEqual([
      { inviteId: "invite-1", reason: "cancelled" },
      { inviteId: "invite-2", reason: "cancelled" },
    ]);
  });

  it("records which owner deleted the workspace, and when", async () => {
    const tenantId = await workspaceWithInvitations();

    await requestWorkspaceDeletion(tenantId, "owner");

    await expect(
      GetModel(TenantSubscriptionModel, tenantId).findOne(),
    ).resolves.toMatchObject({
      status: "cancelled",
      deletionRequestedBy: "owner",
      deletionRequestedAt: ANY_DATE,
    });
  });
});
