import { Logging } from "@antelopejs/interface-core/logging";
import { CROSS_INSTANCE } from "@antelopejs/interface-database";
import { GetModel } from "@antelopejs/interface-database-decorators";
import { TenantMemberModel } from "@antelopejs/interface-dms/db";
import { type User, UserModel } from "@antelopejs/interface-dms/auth/db";
import { DataMigrationModel, PlatformSupportMarkerModel } from "./db";

const LOG_PREFIX = "[dms-saas:platform-support]";
const LEGACY_SUPPORT_MIGRATION = "platform-support-members:v1";

/**
 * Whether a user entering a workspace does it as platform support: a platform
 * owner who does not own the workspace. Owning it makes them a customer, who
 * holds a seat like any other.
 */
export async function isPlatformSupportEntry(
  userId: string,
  isTenantOwner: boolean,
): Promise<boolean> {
  if (isTenantOwner) return false;
  const user = await GetModel(UserModel).get(userId);
  return user?.owner === true;
}

/**
 * Platform owners invited to a workspace come to support it, unless the
 * invitation hands them its ownership: that invitee is the customer.
 */
export async function isPlatformSupportInvite(
  email: string,
  asTenantOwner: boolean,
): Promise<boolean> {
  if (asTenantOwner) return false;
  const user = await GetModel(UserModel).getByEmail(email);
  return user?.owner === true;
}

export async function markPlatformSupport(
  tenantId: string,
  userId: string,
): Promise<void> {
  await GetModel(PlatformSupportMarkerModel, tenantId).mark(userId);
}

export async function releasePlatformSupport(
  tenantId: string,
  userIds: string[],
): Promise<void> {
  await GetModel(PlatformSupportMarkerModel, tenantId).unmark(userIds);
}

async function markLegacySupportOf(owner: User): Promise<number> {
  const memberships = await GetModel(
    TenantMemberModel,
    CROSS_INSTANCE,
  ).listByUserWithTenantIds(owner._id);
  const supported = memberships.filter(({ member }) => !member.isTenantOwner);
  for (const { tenantId } of supported) {
    await markPlatformSupport(tenantId, owner._id);
  }
  return supported.length;
}

/**
 * Support used to be inferred from the platform owner flag alone. Every
 * membership that inference exempted from seats — a platform owner not owning
 * the workspace — is marked once, so it keeps its standing; afterwards only
 * the entry itself marks a membership, and a later promotion to platform
 * owner never turns a customer's seat into support.
 */
export async function migrateLegacyPlatformSupport(): Promise<void> {
  const migrations = GetModel(DataMigrationModel);
  if (await migrations.isApplied(LEGACY_SUPPORT_MIGRATION)) return;
  const owners = await GetModel(UserModel).getOwners();
  let markedCount = 0;
  for (const owner of owners) {
    markedCount += await markLegacySupportOf(owner);
  }
  await migrations.markApplied(LEGACY_SUPPORT_MIGRATION);
  if (markedCount > 0) {
    Logging.Info(
      `${LOG_PREFIX} marked ${markedCount} platform support membership(s)`,
    );
  }
}
