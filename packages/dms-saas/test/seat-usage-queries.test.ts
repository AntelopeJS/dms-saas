import { randomUUID } from "node:crypto";
import { GetModel } from "@antelopejs/interface-database-decorators";
import { type User, UserModel } from "@antelopejs/interface-dms/auth/db";
import {
  type TenantMember,
  TenantMemberModel,
  type UserInvite,
  UserInviteModel,
} from "@antelopejs/interface-dms/db";
import { beforeAll, describe, expect, it } from "vitest";
import {
  countSeatedUsers,
  getSeatUsage,
  type SeatUsage,
} from "../src/plans/seat-capacity";
import { useMongoDatabase } from "./helpers/mongo";
import { insertPlatformOwner, insertUser } from "./helpers/seat-users";

/**
 * Seat usage counts in the database query. Each case compares it with the
 * answer the former implementation computed in memory from every member and
 * invitation of the workspace, on one fixture that holds each rule's edge.
 */

useMongoDatabase();

const DAY_MS = 86_400_000;

/** The seat usage as the former implementation read it from every row. */
async function seatUsageInMemory(
  tenantId: string,
  releasedInviteeEmail?: string,
  departingUserIds: readonly string[] = [],
): Promise<SeatUsage> {
  const normalize = (email: string) => email.trim().toLowerCase();
  const [allMembers, invites, platformOwners] = await Promise.all([
    GetModel(TenantMemberModel, tenantId)
      .table.pluck("userId", "isTenantOwner")
      .run(),
    GetModel(UserInviteModel, tenantId).getAll(),
    GetModel(UserModel).getOwners(),
  ]);
  const byUserId = new Map(platformOwners.map((o) => [o._id, o]));
  const emails = new Set(platformOwners.map((o) => normalize(o.email)));
  const supportOf = (
    member: Pick<TenantMember, "userId" | "isTenantOwner">,
  ): User | undefined =>
    member.isTenantOwner ? undefined : byUserId.get(member.userId);
  const members = allMembers.filter(
    (member) => !departingUserIds.includes(member.userId),
  );
  const pending = new Set(
    invites
      .filter((invite) => new Date(invite.expiresAt).getTime() > Date.now())
      .filter(
        (invite) =>
          invite.asTenantOwner || !emails.has(normalize(invite.email)),
      )
      .map((invite) => normalize(invite.email)),
  );
  if (releasedInviteeEmail) pending.delete(normalize(releasedInviteeEmail));
  const platformSupport = members.flatMap((member) => {
    const owner = supportOf(member);
    return owner
      ? [{ userId: owner._id, name: owner.name, email: owner.email }]
      : [];
  });
  const seated = members.length - platformSupport.length;
  return {
    members: seated,
    pendingInvites: pending.size,
    occupied: seated + pending.size,
    platformSupport,
  };
}

async function seatedInMemory(
  tenantId: string,
  userIds: string[],
): Promise<number> {
  const usage = await seatUsageInMemory(tenantId);
  const support = new Set(usage.platformSupport.map((s) => s.userId));
  return userIds.filter((userId) => !support.has(userId)).length;
}

interface Fixture {
  tenantId: string;
  owner: string;
  coOwner: string;
  member: string;
  support: User;
  departingSupport: User;
  customerPlatformOwner: User;
  invitedPlatformOwner: User;
}

function membership(userId: string, isTenantOwner: boolean) {
  return {
    _id: randomUUID(),
    userId,
    roleIds: [],
    isTenantOwner,
    joinedAt: new Date(),
    invitedBy: null,
  };
}

function invitation(
  email: string,
  expiresInDays: number,
  extra: Partial<UserInvite> = {},
) {
  return {
    _id: randomUUID(),
    createdAt: new Date(),
    email,
    roles_ids: [],
    language: "en",
    token: randomUUID(),
    asTenantOwner: false,
    expiresAt: new Date(Date.now() + expiresInDays * DAY_MS),
    ...extra,
  };
}

let fixture: Fixture;

beforeAll(async () => {
  const tenantId = randomUUID();
  const owner = await insertUser(`${randomUUID()}@acme.test`);
  const coOwner = await insertUser(`${randomUUID()}@acme.test`);
  const member = await insertUser(`${randomUUID()}@acme.test`);
  const support = await insertPlatformOwner();
  const departingSupport = await insertPlatformOwner();
  const customerPlatformOwner = await insertPlatformOwner();
  const invitedPlatformOwner = await insertPlatformOwner();
  const ownerInvitedPlatformOwner = await insertPlatformOwner();
  await GetModel(TenantMemberModel, tenantId).insert([
    membership(owner, true),
    membership(support._id, false),
    membership(member, false),
    membership(customerPlatformOwner._id, true),
    membership(departingSupport._id, false),
    membership(coOwner, true),
  ]);
  await GetModel(UserInviteModel, tenantId).insert([
    invitation("lea@acme.test", 3),
    invitation("resent@acme.test", 3),
    invitation("resent@acme.test", 5, { creationResolutionId: randomUUID() }),
    invitation("expired@acme.test", -1),
    invitation("released@acme.test", 2),
    invitation(invitedPlatformOwner.email, 2),
    invitation(ownerInvitedPlatformOwner.email, 2, { asTenantOwner: true }),
  ]);
  await GetModel(UserInviteModel, randomUUID()).insert([
    invitation("other-workspace@acme.test", 3),
  ]);
  fixture = {
    tenantId,
    owner,
    coOwner,
    member,
    support,
    departingSupport,
    customerPlatformOwner,
    invitedPlatformOwner,
  };
});

describe("seat usage in the database query", () => {
  it("matches the in-memory count of the whole workspace", async () => {
    const usage = await getSeatUsage(fixture.tenantId);

    expect(usage).toEqual(await seatUsageInMemory(fixture.tenantId));
    expect(usage).toMatchObject({ members: 4, pendingInvites: 4 });
    expect(usage.platformSupport.map((s) => s.userId).sort()).toEqual(
      [fixture.support._id, fixture.departingSupport._id].sort(),
    );
  });

  it("matches it with an invitee released and members departing", async () => {
    const departing = [fixture.member, fixture.departingSupport._id];
    const released = " Released@ACME.test ";

    const usage = await getSeatUsage(fixture.tenantId, released, departing);

    expect(usage).toEqual(
      await seatUsageInMemory(fixture.tenantId, released, departing),
    );
    expect(usage).toMatchObject({ members: 3, pendingInvites: 3 });
  });

  it("matches the seats a set of members holds, repeats included", async () => {
    const userIds = [
      fixture.owner,
      fixture.support._id,
      fixture.member,
      fixture.member,
      fixture.customerPlatformOwner._id,
      fixture.support._id,
    ];

    const seated = await countSeatedUsers(fixture.tenantId, userIds);

    expect(seated).toBe(await seatedInMemory(fixture.tenantId, userIds));
    expect(seated).toBe(4);
  });

  it("counts an empty workspace as holding no seat", async () => {
    const empty = randomUUID();

    expect(await getSeatUsage(empty)).toEqual(await seatUsageInMemory(empty));
    expect(await countSeatedUsers(empty, [])).toBe(0);
  });
});
