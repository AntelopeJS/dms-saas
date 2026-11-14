import { randomUUID } from "node:crypto";
import { GetModel } from "@antelopejs/interface-database-decorators";
import { type User, UserModel } from "@antelopejs/interface-dms/auth/db";
import { type UserInvite, UserInviteModel } from "@antelopejs/interface-dms/db";

/** The invitations of a workspace, pending or not. */
export async function pendingInvites(tenantId: string): Promise<UserInvite[]> {
  return GetModel(UserInviteModel, tenantId).getAll();
}

/** Stores a user, a platform owner when asked; returns its id. */
export async function insertUser(
  email: string,
  isPlatformOwner = false,
): Promise<string> {
  const userId = randomUUID();
  await GetModel(UserModel).insert({
    _id: userId,
    email,
    name: "Invitee",
    language: "en",
    owner: isPlatformOwner,
  });
  return userId;
}

/** Stores a platform owner and reads it back. */
export async function insertPlatformOwner(): Promise<User> {
  const email = `${randomUUID()}@platform.test`;
  const user = await GetModel(UserModel).get(await insertUser(email, true));
  if (!user) throw new Error("Expected the platform owner");
  return user;
}
