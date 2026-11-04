import { randomBytes } from "node:crypto";
import { type User, UserModel } from "@antelopejs/interface-dms/auth/db";
import { SEED_PASSWORD } from "../data/people";
import type { SeedUser } from "../data/types";
import { dayFrom, insertMissing, optionalDayFrom, type SeedRow } from "./rows";

/** Bytes behind a 64-character auth key, the length the DMS mints. */
const AUTH_KEY_BYTES = 48;

function toUserRow(user: SeedUser): SeedRow<User> {
  const createdAt = dayFrom(user.createdOn);
  return {
    _id: user.id,
    name: user.name,
    email: user.email,
    password: SEED_PASSWORD,
    passwordChangedAt: null,
    avatar: null,
    language: user.language,
    authKey: randomBytes(AUTH_KEY_BYTES).toString("base64url"),
    isValidated: user.isValidated,
    validationToken: null,
    validationRequestedAt: user.isValidated ? null : createdAt,
    forgotPasswordToken: null,
    forgotPasswordRequestedAt: null,
    owner: user.isPlatformAdmin,
    lastActiveAt: optionalDayFrom(user.lastActiveOn),
    twoFactorMethods: [],
    twoFactorSecret: null,
    twoFactorPendingSecret: null,
    twoFactorBackupCodes: [],
    twoFactorBackupCodesGeneratedAt: null,
    twoFactorBackupCodesSavedAt: null,
    twoFactorEmailCode: null,
    twoFactorEmailCodeRequestedAt: null,
    createdAt,
    updatedAt: createdAt,
  };
}

export async function writeUsers(users: SeedUser[]): Promise<void> {
  await insertMissing(UserModel, users.map(toUserRow));
}
