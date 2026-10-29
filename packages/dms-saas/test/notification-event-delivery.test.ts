import { randomUUID } from "node:crypto";
import { ImplementInterface } from "@antelopejs/interface-core";
import { GetModel } from "@antelopejs/interface-database-decorators";
import { TenantMemberModel } from "@antelopejs/interface-dms/db";
import * as notifications from "@antelopejs/interface-dms/notifications";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  notifyTenantMembers,
  notifyTenantOwners,
} from "../src/notifications/recipients";
import { freeWorkspaceExpiredSubject } from "../src/notifications/subjects";
import { addTenantMember, createUser } from "./helpers/dms";
import { useMongoDatabase } from "./helpers/mongo";

useMongoDatabase("notification-events");

const core = {
  sendToUsers: vi.fn<typeof notifications.internal.SendToUsers>(),
  sendToUser: vi.fn<typeof notifications.internal.SendToUser>(),
};

ImplementInterface(notifications, {
  internal: {
    SupportsIdempotency: async () => true,
    RegisterNotificationCategory: {
      register: () => undefined,
      unregister: () => undefined,
    },
    RegisterNotificationSubject: {
      register: () => undefined,
      unregister: () => undefined,
    },
    SendToUser: core.sendToUser,
    SendToUsers: core.sendToUsers,
    SendToRoles: vi.fn(),
    SendToAll: vi.fn(),
  },
});

const payload = {
  eventId: "expiry:subscription-a:2026-09-10",
  icon: "i-ph-hourglass",
  title: "Expired",
  description: "Complimentary access expired.",
  linkTo: "/billing",
};

/** The recipients, link and event key of each send core received, in order. */
function keyedSends() {
  return core.sendToUsers.mock.calls.map(
    ([userIds, data, , idempotencyKey]) => ({
      userIds,
      linkTo: data.linkTo,
      idempotencyKey,
    }),
  );
}

function sendTo(userIds: string[]) {
  return { userIds, linkTo: payload.linkTo, idempotencyKey: payload.eventId };
}

/** A workspace with two members, neither of them its owner. */
async function createWorkspace() {
  const tenantId = randomUUID();
  const members = [await createUser(), await createUser()];
  for (const member of members) await addTenantMember(tenantId, member);
  return { tenantId, memberIds: members.map((member) => member._id) };
}

beforeEach(() => {
  vi.resetAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("durable notification event forwarding", () => {
  it("forwards overlapping deliveries with the same event identity to core", async () => {
    const { tenantId, memberIds } = await createWorkspace();

    await Promise.all([
      notifyTenantMembers(tenantId, freeWorkspaceExpiredSubject, payload),
      notifyTenantMembers(tenantId, freeWorkspaceExpiredSubject, payload),
    ]);
    expect(keyedSends()).toEqual([sendTo(memberIds), sendTo(memberIds)]);
    expect(core.sendToUser).not.toHaveBeenCalled();
  });

  it("propagates partial delivery failure and retries the full recipient set", async () => {
    const { tenantId, memberIds } = await createWorkspace();
    const error = new Error("second recipient unavailable");
    core.sendToUsers.mockRejectedValueOnce(error);
    await expect(
      notifyTenantMembers(tenantId, freeWorkspaceExpiredSubject, payload),
    ).rejects.toBe(error);
    await notifyTenantMembers(tenantId, freeWorkspaceExpiredSubject, payload);
    expect(keyedSends()).toEqual([sendTo(memberIds), sendTo(memberIds)]);
  });

  it("propagates recipient resolution failure without consuming the event", async () => {
    const { tenantId } = await createWorkspace();
    const owner = await createUser();
    await addTenantMember(tenantId, owner, true);
    const error = new Error("owners unavailable");
    vi.spyOn(
      GetModel(TenantMemberModel, tenantId),
      "listOwners",
    ).mockRejectedValueOnce(error);
    await expect(
      notifyTenantOwners(tenantId, freeWorkspaceExpiredSubject, payload),
    ).rejects.toBe(error);
    expect(core.sendToUsers).not.toHaveBeenCalled();
    await notifyTenantOwners(tenantId, freeWorkspaceExpiredSubject, payload);
    expect(keyedSends()).toEqual([sendTo([owner._id])]);
  });
});
