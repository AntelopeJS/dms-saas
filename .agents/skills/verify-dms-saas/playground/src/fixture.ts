import { randomBytes } from "node:crypto";
import {
  Controller,
  Get,
  JSONBody,
  Parameter,
  Post,
} from "@antelopejs/interface-api";
import { type DeepPartial, GetModel } from "@antelopejs/interface-database-decorators";
import { generateTenantAssignmentToken } from "@antelopejs/interface-dms/auth";
import { UserModel } from "@antelopejs/interface-dms/auth/db";
import { RoleModel, UserInviteModel } from "@antelopejs/interface-dms/db";
import { GetEffectiveUserPermissions } from "@antelopejs/interface-dms/permissions";
import { Hook, RegisterHook } from "@antelopejs/interface-dms/hooks";
import {
  GetTenantBillingPeriod,
  GetTenantCustomerBalance,
  GetUpcomingInvoicePreview,
  RecomputeTenantBillingState,
} from "@antelopejs/interface-dms-saas/billing";
import { StripeWebhookEventModel, type TenantSubscription, TenantSubscriptionModel } from "@antelopejs/interface-dms-saas/db";

const AUTH_KEY_BYTES = 32;
const HOUR_MS = 3_600_000;
const FAILING_EXTRA = "verifyFailProvisioning";

/** What `Hook.TENANT_BEING_PROVISIONED` listeners received, newest last. */
const provisioned: {
  tenantId: string;
  userId: string | undefined;
  extras: unknown;
}[] = [];

interface PermissionsBody {
  tenantId: string;
  userId: string;
  rolePermissions: string[];
}

interface SubscriptionBody {
  tenantId: string;
  planId: string;
  status: "active" | "trialing" | "past_due" | "pending_payment" | "suspended" | "cancelled";
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
  isComplimentary?: boolean;
  currentPeriodEnd?: string;
  pastDueSince?: string;
}

interface ScopeBody {
  tenantId: string;
  userId: string;
}

interface ExpiredInviteBody {
  tenantId: string;
  email: string;
  roleId: string;
}

interface TenantBody {
  tenantId: string;
}

/** What a call of the public interface answered: its result, or the rejection it threw. */
async function answered<T>(call: () => Promise<T>) {
  try {
    return { ok: true, result: await call() };
  } catch (error) {
    return { ok: false, rejection: error instanceof Error ? error.message : JSON.stringify(error) };
  }
}

interface AccountBody {
  email: string;
  name: string;
  password: string;
}

/** Records every provisioning, as a project listener that stores sign-up answers would see it. */
export function recordProvisioning(): void {
  RegisterHook(Hook.TENANT_BEING_PROVISIONED, async (payload) => {
    if (JSON.stringify(payload.extras ?? {}).includes(FAILING_EXTRA))
      throw new Error("the verification listener refuses this workspace");
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
  async accountWithoutWorkspace(@JSONBody() account: AccountBody) {
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
  async effectivePermissions(@JSONBody() body: PermissionsBody) {
    const { tenantId, userId, rolePermissions } = body;
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

  /** Publishes the billing and directory state of a workspace again, as a project must after writing subscription rows directly. */
  @Post("/recompute")
  async recompute(@JSONBody() body: TenantBody) {
    const { tenantId } = body;
    await RecomputeTenantBillingState(tenantId);
    return { ok: true };
  }

  /** Writes a subscription of a workspace the way a paid flow leaves it, then publishes the workspace's state. */
  @Post("/subscription")
  async subscription(@JSONBody() input: SubscriptionBody) {
    const patch: DeepPartial<TenantSubscription> = {
      planId: input.planId,
      status: input.status,
      stripeCustomerId: input.stripeCustomerId ?? null,
      stripeSubscriptionId: input.stripeSubscriptionId ?? null,
      isComplimentary: input.isComplimentary ?? false,
      updatedAt: new Date(),
    };
    if (input.currentPeriodEnd) patch.currentPeriodEnd = new Date(input.currentPeriodEnd);
    if (input.pastDueSince) patch.pastDueSince = new Date(input.pastDueSince);
    await GetModel(TenantSubscriptionModel, input.tenantId).update(input.tenantId, patch);
    await RecomputeTenantBillingState(input.tenantId);
    return { ok: true };
  }

  /** `GetTenantCustomerBalance` for a scope taken from the request body. */
  @Post("/interface/balance")
  balance(@JSONBody() scope: ScopeBody) {
    return answered(() => GetTenantCustomerBalance(scope));
  }

  /** `GetUpcomingInvoicePreview` for a scope taken from the request body. */
  @Post("/interface/preview")
  preview(@JSONBody() scope: ScopeBody) {
    return answered(() => GetUpcomingInvoicePreview(scope));
  }

  /** `GetTenantBillingPeriod` of a workspace. */
  @Post("/interface/period")
  period(@JSONBody() body: TenantBody) {
    const { tenantId } = body;
    return answered(() => GetTenantBillingPeriod(tenantId));
  }

  /** The invitations a workspace holds, with their expiry. */
  @Get("/invites/:tenantId")
  async invites(@Parameter("tenantId") tenantId: string) {
    const rows = await GetModel(UserInviteModel, tenantId).getAll();
    return rows.map((row) => ({
      id: row._id,
      email: row.email,
      expiresAt: row.expiresAt.toISOString(),
    }));
  }

  /** An invitation that expired an hour ago. */
  @Post("/expired-invite")
  async expiredInvite(@JSONBody() body: ExpiredInviteBody) {
    await GetModel(UserInviteModel, body.tenantId).insert({
      email: body.email,
      roles_ids: [body.roleId],
      language: "en",
      token: randomBytes(AUTH_KEY_BYTES).toString("hex"),
      asTenantOwner: false,
      expiresAt: new Date(Date.now() - HOUR_MS),
    });
    return { ok: true };
  }
}
