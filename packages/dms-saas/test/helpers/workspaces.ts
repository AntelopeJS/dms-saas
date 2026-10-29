import { randomUUID } from "node:crypto";
import type { RequestContext } from "@antelopejs/interface-api";
import { GetModel } from "@antelopejs/interface-database-decorators";
import type { User } from "@antelopejs/interface-dms/auth/db";
import { TenantMemberModel, TenantModel } from "@antelopejs/interface-dms/db";
import { setRuntimeConfig } from "../../src/config";
import { addTenantMember, createUser, tenantRequest } from "./dms";
import { SUITE_STRIPE_KEYS } from "./stripe";

/** Stores a workspace row, which the routes of a workspace read before acting on it. */
export async function insertTenant(tenantId: string): Promise<void> {
  const now = new Date();
  await GetModel(TenantModel).insert({
    _id: tenantId,
    name: tenantId,
    createdAt: now,
    updatedAt: now,
  });
}

/** Seats `count` members in a workspace, each holding one seat. */
export async function seatMembers(
  tenantId: string,
  count: number,
): Promise<void> {
  const members = GetModel(TenantMemberModel, tenantId);
  for (let seat = 0; seat < count; seat++) {
    await members.insert({
      _id: randomUUID(),
      userId: randomUUID(),
      roleIds: [],
      isTenantOwner: false,
      joinedAt: new Date(),
      invitedBy: null,
    });
  }
}

/** A workspace and the request of its owner, signed in to it. */
export interface OwnedWorkspace {
  tenantId: string;
  owner: User;
  request: RequestContext;
}

/** Creates a workspace row and an owner who is its owning member, with a request of theirs. */
export async function createOwnedWorkspace(): Promise<OwnedWorkspace> {
  const tenantId = randomUUID();
  await insertTenant(tenantId);
  const owner = await createUser();
  await addTenantMember(tenantId, owner, true);
  return { tenantId, owner, request: await tenantRequest(owner, tenantId) };
}

/** Lets plan changes send Stripe Checkout back to pages of `example.test`. */
export function allowCheckoutRedirects(): void {
  setRuntimeConfig({
    stripe: SUITE_STRIPE_KEYS,
    allowedRedirectHosts: ["example.test"],
  });
}
