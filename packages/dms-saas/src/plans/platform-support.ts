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
  await GetModel(PlatformSupportMarkerModel, tenantId).mark(tenantId, userId);
}

export async function releasePlatformSupport(
  tenantId: string,
  userIds: string[],
): Promise<void> {
  await GetModel(PlatformSupportMarkerModel, tenantId).unmark(userIds);
}

/** Runs every step, logs each failure, and reports how many failed. */
async function settleEach<T>(
  items: T[],
  step: (item: T) => Promise<void>,
  describe: (item: T) => string,
): Promise<number> {
  let failures = 0;
  for (const item of items) {
    try {
      await step(item);
    } catch (error) {
      failures += 1;
      Logging.Warn(`${LOG_PREFIX} ${describe(item)} failed`, error);
    }
  }
  return failures;
}

/**
 * Markers were first keyed by the user id alone, which the shared collection
 * of every workspace holds only once. Those already written move to their
 * per-workspace key; a failed one stays readable by the next boot.
 */
async function rekeyLegacyMarkers(): Promise<number> {
  const legacy = await GetModel(
    PlatformSupportMarkerModel,
    CROSS_INSTANCE,
  ).listLegacyKeyed();
  return settleEach(
    legacy,
    ({ tenantId, userId }) =>
      GetModel(PlatformSupportMarkerModel, tenantId).rekeyLegacy(
        tenantId,
        userId,
      ),
    ({ tenantId, userId }) => `rekeying the marker of ${userId} in ${tenantId}`,
  );
}

async function markLegacySupportOf(owner: User): Promise<number> {
  const memberships = await GetModel(
    TenantMemberModel,
    CROSS_INSTANCE,
  ).listByUserWithTenantIds(owner._id);
  const supported = memberships.filter(({ member }) => !member.isTenantOwner);
  const failures = await settleEach(
    supported,
    ({ tenantId }) => markPlatformSupport(tenantId, owner._id),
    ({ tenantId }) => `marking the support of ${owner._id} in ${tenantId}`,
  );
  if (failures > 0) throw new Error(`${failures} marking(s) failed`);
  return supported.length;
}

/**
 * Support used to be inferred from the platform owner flag alone. Every
 * membership that inference exempted from seats — a platform owner not owning
 * the workspace — is marked once, so it keeps its standing; afterwards only
 * the entry itself marks a membership, and a later promotion to platform
 * owner never turns a customer's seat into support.
 *
 * A single record failing never stops the module: it is logged and the
 * migration stays pending, so the next boot retries it. Only a failure to
 * read the records at all is fatal.
 */
export async function migrateLegacyPlatformSupport(): Promise<void> {
  const rekeyFailures = await rekeyLegacyMarkers();
  const migrations = GetModel(DataMigrationModel);
  if (await migrations.isApplied(LEGACY_SUPPORT_MIGRATION)) return;
  const owners = await GetModel(UserModel).getOwners();
  let markedCount = 0;
  const ownerFailures = await settleEach(
    owners,
    async (owner) => {
      markedCount += await markLegacySupportOf(owner);
    },
    (owner) => `marking the support memberships of ${owner._id}`,
  );
  if (markedCount > 0) {
    Logging.Info(
      `${LOG_PREFIX} marked ${markedCount} platform support membership(s)`,
    );
  }
  if (rekeyFailures + ownerFailures > 0) {
    Logging.Warn(
      `${LOG_PREFIX} migration left pending, retried at the next boot`,
    );
    return;
  }
  await migrations.markApplied(LEGACY_SUPPORT_MIGRATION);
}
