import { randomUUID } from "node:crypto";
import { GetModel } from "@antelopejs/interface-database-decorators";
import { UserInviteModel } from "@antelopejs/interface-dms/db";
import { ExecuteHooks, Hook } from "@antelopejs/interface-dms/hooks";
import { describe, expect, it, vi } from "vitest";
import { registerWorkspaceDirectoryHooks } from "../src/billing-state/directory-hooks";
import { type TenantBillingState, TenantBillingStateModel } from "../src/db";
import { addTenantMember, createUser } from "./helpers/dms";
import { useMongoDatabase } from "./helpers/mongo";

useMongoDatabase("directory-hooks");
registerWorkspaceDirectoryHooks();

const INVITEE_EMAIL = "a@b.c";
const INVITATION_LIFETIME_MS = 86_400_000;

/** Waits until the directory row the hooks publish for the tenant holds `fields`. */
async function expectDirectoryRow(
  tenantId: string,
  fields: Partial<TenantBillingState>,
): Promise<void> {
  await vi.waitFor(async () => {
    expect(
      await GetModel(TenantBillingStateModel).findByTenant(tenantId),
    ).toMatchObject(fields);
  });
}

/** Stores a pending invitation of the invitee to the tenant, as the DMS does. */
async function invite(tenantId: string): Promise<string> {
  const inviteId = randomUUID();
  const now = Date.now();
  await GetModel(UserInviteModel, tenantId).insert({
    _id: inviteId,
    createdAt: new Date(now),
    email: INVITEE_EMAIL,
    firstname: null,
    lastname: null,
    roles_ids: [],
    language: "en",
    token: randomUUID(),
    asTenantOwner: false,
    expiresAt: new Date(now + INVITATION_LIFETIME_MS),
    extensions: null,
  });
  return inviteId;
}

describe("workspace directory hooks", () => {
  it("leaves out the members being removed, at once", async () => {
    const tenantId = randomUUID();
    const departing = await createUser({ name: "Departing Owner" });
    await addTenantMember(tenantId, departing, true);
    await addTenantMember(tenantId, await createUser(), false);

    await ExecuteHooks(Hook.MEMBER_REMOVED, {
      tenantId,
      userIds: [departing._id],
    });

    await expectDirectoryRow(tenantId, {
      members: 1,
      seats: 1,
      ownerStatus: "none",
      ownerEmail: null,
    });
  });

  it("releases the seat of a cancelled invitation, not of a resent one", async () => {
    const tenantId = randomUUID();
    await addTenantMember(tenantId, await createUser(), true);
    const inviteId = await invite(tenantId);

    await ExecuteHooks(Hook.INVITE_DELETED, {
      tenantId,
      inviteId,
      email: INVITEE_EMAIL,
      reason: "cancelled",
    });
    await expectDirectoryRow(tenantId, { members: 1, seats: 1 });

    await ExecuteHooks(Hook.INVITE_DELETED, {
      tenantId,
      inviteId,
      email: INVITEE_EMAIL,
      reason: "resent",
    });
    await expectDirectoryRow(tenantId, { members: 1, seats: 2 });
  });
});
