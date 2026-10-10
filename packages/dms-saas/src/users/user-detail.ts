import { assert } from "@antelopejs/interface-api-util";
import { CROSS_INSTANCE } from "@antelopejs/interface-database";
import { GetModel } from "@antelopejs/interface-database-decorators";
import { TenantMemberModel, TenantModel } from "@antelopejs/interface-dms/db";
import {
  type Session,
  SessionModel,
  type User,
  UserExternalIdentityModel,
  UserModel,
} from "@antelopejs/interface-dms/auth/db";
import { InvoiceModel, UserSegmentModel } from "../db";

const HTTP_NOT_FOUND = 404;
const PAID_STATUS = "paid";
const PASSWORD_METHOD = "password";

/** A workspace of the user, with their place in it. */
export interface UserWorkspace {
  tenantId: string;
  name: string;
  isTenantOwner: boolean;
  joinedAt: Date | null;
}

/** An amount of money in one currency, in minor units. */
export interface MoneyTotal {
  currency: string;
  amount: number;
}

/** The device and place of the user's latest session. */
export interface LastSession {
  browser: string;
  os: string;
  location: string;
}

/** How the user signs in, from what the DMS stores of them. */
export interface UserSecurity {
  /** `password`, then the identity providers bound to the account. */
  signInMethods: string[];
  /** The second factors enabled (`totp`, `email`…); empty when off. */
  twoFactorMethods: string[];
  /** Backup codes left; null when none were ever generated. */
  backupCodesLeft: number | null;
  activeSessions: number;
  /** Distinct places of the active sessions. */
  sessionLocations: string[];
  isEmailVerified: boolean;
  /** When the address was last asked to be verified, while it is not. */
  verificationRequestedAt: Date | null;
}

/** A user as the platform admin's user page shows them. */
export interface UserDetail {
  _id: string;
  name: string;
  email: string;
  avatar: User["avatar"];
  language: string | null;
  createdAt: Date;
  lastActiveAt: Date | null;
  lastSession: LastSession | null;
  isPlatformAdmin: boolean;
  /** The user is the platform admin asking. */
  isSelf: boolean;
  workspaces: UserWorkspace[];
  /** Paid invoices of the workspaces the user owns, per currency. */
  billedAsOwner: MoneyTotal[];
  segmentCount: number;
  security: UserSecurity;
}

function newestSession(sessions: readonly Session[]): Session | undefined {
  return [...sessions].sort(
    (a, b) =>
      new Date(b.lastActiveAt).getTime() - new Date(a.lastActiveAt).getTime(),
  )[0];
}

function latestDate(...dates: (Date | null | undefined)[]): Date | null {
  const times = dates
    .filter((date): date is Date => !!date)
    .map((date) => new Date(date).getTime());
  return times.length > 0 ? new Date(Math.max(...times)) : null;
}

async function loadWorkspaces(userId: string): Promise<UserWorkspace[]> {
  const rows = await GetModel(
    TenantMemberModel,
    CROSS_INSTANCE,
  ).listByUserWithTenantIds(userId);
  const tenants = await GetModel(TenantModel).getMany(
    rows.map((row) => row.tenantId),
  );
  const names = new Map(tenants.map((tenant) => [tenant._id, tenant.name]));
  return rows.map((row) => ({
    tenantId: row.tenantId,
    name: names.get(row.tenantId) ?? row.tenantId,
    isTenantOwner: !!row.member.isTenantOwner,
    joinedAt: row.member.joinedAt ?? null,
  }));
}

/** Paid invoices of the given workspaces, summed per currency. */
export async function sumPaidInvoices(
  tenantIds: readonly string[],
): Promise<MoneyTotal[]> {
  const invoices = (
    await Promise.all(
      tenantIds.map((tenantId) =>
        GetModel(InvoiceModel, tenantId).getAllInvoices(),
      ),
    )
  ).flat();
  const totals = new Map<string, number>();
  for (const invoice of invoices) {
    if (invoice.status !== PAID_STATUS) continue;
    const currency = (invoice.currency || "").toUpperCase();
    totals.set(currency, (totals.get(currency) ?? 0) + invoice.total);
  }
  return [...totals].map(([currency, amount]) => ({ currency, amount }));
}

function securityOf(
  user: User,
  sessions: readonly Session[],
  providers: readonly string[],
): UserSecurity {
  const backupCodes = user.twoFactorBackupCodes ?? [];
  return {
    signInMethods: [
      ...(user.password ? [PASSWORD_METHOD] : []),
      ...new Set(providers),
    ],
    twoFactorMethods: user.twoFactorMethods ?? [],
    backupCodesLeft: user.twoFactorBackupCodesGeneratedAt
      ? backupCodes.length
      : null,
    activeSessions: sessions.length,
    sessionLocations: [
      ...new Set(sessions.map((session) => session.location).filter(Boolean)),
    ],
    isEmailVerified: !!user.isValidated,
    verificationRequestedAt: user.isValidated
      ? null
      : (user.validationRequestedAt ?? null),
  };
}

async function requireUser(userId: string): Promise<User> {
  const user = await GetModel(UserModel).get(userId);
  assert(user, HTTP_NOT_FOUND, "saas.errors.user.not_found");
  return user;
}

/** Everything the user page shows of a user, as seen by `actorId`. */
export async function loadUserDetail(
  userId: string,
  actorId: string,
): Promise<UserDetail> {
  const user = await requireUser(userId);
  const [workspaces, sessions, identities, segments] = await Promise.all([
    loadWorkspaces(userId),
    GetModel(SessionModel).getByUserId(userId),
    GetModel(UserExternalIdentityModel).getByUserId(userId),
    GetModel(UserSegmentModel).listByUser(userId),
  ]);
  const owned = workspaces.filter((workspace) => workspace.isTenantOwner);
  const latest = newestSession(sessions);
  return {
    _id: user._id,
    name: user.name ?? "",
    email: user.email,
    avatar: user.avatar ?? null,
    language: user.language || null,
    createdAt: user.createdAt,
    lastActiveAt: latestDate(user.lastActiveAt, latest?.lastActiveAt),
    lastSession: latest
      ? { browser: latest.browser, os: latest.os, location: latest.location }
      : null,
    isPlatformAdmin: !!user.owner,
    isSelf: userId === actorId,
    workspaces,
    billedAsOwner: await sumPaidInvoices(owned.map((w) => w.tenantId)),
    segmentCount: segments.length,
    security: securityOf(
      user,
      sessions,
      identities.map((identity) => identity.provider),
    ),
  };
}
