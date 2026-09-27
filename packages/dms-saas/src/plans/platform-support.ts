import { GetModel } from "@antelopejs/interface-database-decorators";
import { UserModel } from "@antelopejs/interface-dms/auth/db";

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
