import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import type { AuthConfig, Config } from "@antelopejs/dms";
import type { RequestContext } from "@antelopejs/interface-api";
import { ImplementInterface } from "@antelopejs/interface-core";
import { GetModel } from "@antelopejs/interface-database-decorators";
import * as auth from "@antelopejs/interface-dms/auth";
import { type User, UserModel } from "@antelopejs/interface-dms/auth/db";
import { TenantMemberModel } from "@antelopejs/interface-dms/db";
import * as guards from "@antelopejs/interface-dms/guards";
import { resolveRequestTenantId } from "@antelopejs/interface-dms/request-tenant";
import * as tenantAccess from "@antelopejs/interface-dms/tenant-access";
import { fromPartial } from "@total-typescript/shoehorn";

const require = createRequire(import.meta.url);
const DMS_DIST = join(
  dirname(require.resolve("@antelopejs/dms/package.json")),
  "dist",
);

/** The JWT secret of the DMS configuration {@link useDmsAuth} applies. */
const SUITE_JWT_SECRET = "dms-saas-suite-only";

/**
 * Implements an `@antelopejs/interface-dms` declaration with the DMS runtime's
 * own implementation, as the DMS module's `construct` does.
 *
 * @param declaration The interface module, imported as a namespace
 * @param implementation Path of the implementation under the DMS `dist`, e.g. `implementations/dms/tenant-access.js`
 */
export function implementWithDms<T extends Record<string, unknown>>(
  declaration: T,
  implementation: string,
): void {
  ImplementInterface(declaration, require(join(DMS_DIST, implementation)));
}

/** Applies a DMS configuration the way the DMS module's `construct` does. */
export function applyDmsConfig(config: Config): void {
  const { applyConfig } = require(join(DMS_DIST, "config.js"));
  applyConfig(config);
}

/**
 * Wires the DMS's authentication, tenant guards and tenant access gate, with a
 * suite JWT secret: bearer tokens from {@link tenantRequest} then authenticate
 * against real user and membership rows. Needs a database
 * (`useMongoDatabase`) for those rows.
 */
export function useDmsAuth(): void {
  applyDmsConfig({
    auth: fromPartial<AuthConfig>({
      jwtSecret: SUITE_JWT_SECRET,
      mustValidateEmail: false,
    }),
  });
  implementWithDms(auth, "implementations/dms-auth/index.js");
  implementWithDms(guards, "implementations/dms/guards.js");
  implementWithDms(tenantAccess, "implementations/dms/tenant-access.js");
}

/** Inserts a validated user, with the fields the DMS authenticates against. */
export async function createUser(overrides: Partial<User> = {}): Promise<User> {
  const id = overrides._id ?? randomUUID();
  const users = GetModel(UserModel);
  await users.insert({
    _id: id,
    email: `${id}@example.test`,
    name: "Suite User",
    language: "en",
    password: null,
    authKey: randomUUID(),
    isValidated: true,
    owner: false,
    twoFactorMethods: [],
    twoFactorBackupCodes: [],
    ...overrides,
  });
  const user = await users.get(id);
  if (!user) throw new Error(`User ${id} was not stored`);
  return user;
}

/** Makes a user a member of a tenant, or its owner. */
export async function addTenantMember(
  tenantId: string,
  user: User,
  isTenantOwner = false,
): Promise<void> {
  await GetModel(TenantMemberModel, tenantId).insert({
    _id: randomUUID(),
    userId: user._id,
    roleIds: [],
    isTenantOwner,
    joinedAt: new Date(),
    invitedBy: null,
  });
}

/**
 * A request carrying the user's bearer token for the tenant, as the browser
 * sends it, already resolved to that tenant the way the DMS resolves it before
 * a route runs: `getRequestTenantId` of the request then names `tenantId`.
 */
export async function tenantRequest(
  user: User,
  tenantId: string,
): Promise<RequestContext> {
  const { token } = await auth.generateAccessToken(tenantId, user);
  const request = fromPartial<RequestContext>({
    rawRequest: { headers: { authorization: `Bearer ${token}` } },
  });
  await resolveRequestTenantId(request);
  return request;
}
