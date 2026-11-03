import { randomBytes } from "node:crypto";
import {
  Controller,
  Get,
  JSONBody,
  Post,
} from "@antelopejs/interface-api";
import { GetModel } from "@antelopejs/interface-database-decorators";
import { generateTenantAssignmentToken } from "@antelopejs/interface-dms/auth";
import { UserModel } from "@antelopejs/interface-dms/auth/db";
import { RoleModel } from "@antelopejs/interface-dms/db";
import { GetEffectiveUserPermissions } from "@antelopejs/interface-dms/permissions";
import { Hook, RegisterHook } from "@antelopejs/interface-dms/hooks";
import { StripeWebhookEventModel } from "@antelopejs/interface-dms-saas/db";
import { z } from "zod";

const AUTH_KEY_BYTES = 32;

/** What `Hook.TENANT_BEING_PROVISIONED` listeners received, newest last. */
const provisioned: {
  tenantId: string;
  userId: string | undefined;
  extras: unknown;
}[] = [];

const permissionsSchema = z.object({
  tenantId: z.string(),
  userId: z.string(),
  rolePermissions: z.array(z.string()),
});

const accountSchema = z.object({
  email: z.string(),
  name: z.string(),
  password: z.string(),
});

/** Records every provisioning, as a project listener that stores sign-up answers would see it. */
export function recordProvisioning(): void {
  RegisterHook(Hook.TENANT_BEING_PROVISIONED, async (payload) => {
    provisioned.push({
      tenantId: payload.tenantId,
      userId: payload.userId,
      extras: payload.extras,
    });
    return undefined;
  });
}

/** The verification playground's trusted backend calls, under `/verify-saas`. */
export class VerifySaasFixtureController extends Controller("/verify-saas") {
  @Get("/ping")
  ping() {
    return { ok: true };
  }

  /** The provisioning payloads the listener recorded. */
  @Get("/provisioned")
  listProvisioned() {
    return provisioned;
  }

  /** An account that belongs to no workspace, with the token the sign-in completion screen relays. */
  @Post("/account-without-workspace")
  async accountWithoutWorkspace(@JSONBody() body: unknown) {
    const account = accountSchema.parse(body);
    const model = GetModel(UserModel);
    const [userId] = await model.insert([
      {
        email: account.email,
        name: account.name,
        password: account.password,
        authKey: randomBytes(AUTH_KEY_BYTES).toString("hex"),
        owner: false,
        createdAt: new Date(),
      },
    ]);
    const user = await model.get(userId);
    if (!user) throw new Error(`user ${userId} was not written`);
    const { token } = await generateTenantAssignmentToken(user);
    return { userId, token };
  }

  /** The effective permissions of a user of a workspace who holds one role granting `rolePermissions`, after every permissions resolver. */
  @Post("/effective-permissions")
  async effectivePermissions(@JSONBody() body: unknown) {
    const { tenantId, userId, rolePermissions } = permissionsSchema.parse(body);
    const roles = GetModel(RoleModel, tenantId);
    const [roleId] = await roles.insert({
      name: `verify role ${randomBytes(4).toString("hex")}`,
      permissions: rolePermissions,
    });
    const effective = await GetEffectiveUserPermissions(
      { _id: userId },
      tenantId,
      roleId === undefined ? [] : [roleId],
      roles,
    );
    return { permissions: [...effective].sort() };
  }

  /** The processing records of the Stripe events the webhook endpoint admitted. */
  @Get("/webhook-events")
  async webhookEvents() {
    const rows = await GetModel(StripeWebhookEventModel).getAll();
    return rows.map((row) => ({
      id: row._id,
      type: row.type,
      result: row.result,
    }));
  }
}
