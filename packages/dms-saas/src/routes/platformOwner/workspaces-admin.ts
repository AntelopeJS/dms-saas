import { randomUUID } from "node:crypto";
import {
  Controller,
  Get,
  JSONBody,
  Parameter,
  Post,
} from "@antelopejs/interface-api";
import { assert } from "@antelopejs/interface-api-util";
import { GetModel, Model } from "@antelopejs/interface-database-decorators";
import { TenantMemberModel, TenantModel } from "@antelopejs/interface-dms/db";
import { runTenantLifecycleOperation } from "@antelopejs/interface-dms/tenant-lifecycle";
import { applyTenantOwnership } from "@antelopejs/interface-dms/tenant-ownership";
import { AuthOwnerOnly } from "@antelopejs/interface-dms/auth";
import { type User, UserModel } from "@antelopejs/interface-dms/auth/db";
import type { ConfirmDialog } from "@antelopejs/interface-dms/base";
import { recomputeTenantBillingState } from "../../billing-state";
import {
  type Plan,
  PlanModel,
  TenantBillingInfoModel,
  TenantSubscriptionModel,
  type TenantSubscriptionStatus,
} from "../../db";
import {
  complimentaryAccessGrantedSubject,
  notifyTenantOwners,
} from "../../notifications";
import {
  type ComplimentaryImpact,
  loadComplimentaryImpact,
} from "../../operator-actions/previews";
import { getStripeClient } from "../../stripe";
import { parseFutureDate } from "../../utils";
import { closePaidUsagePeriods } from "../../workspaces/complimentary";
import {
  loadWorkspaceOperatorView,
  type WorkspaceOperatorView,
} from "../../workspaces/operator-view";
import {
  type CreatedWorkspace,
  type CreateWorkspaceBody,
  createWorkspaceForOwner,
  loadPlanForAccess,
  lookUpOwner,
  type OwnerLookup,
  validateWorkspaceInput,
} from "../../workspaces/operator-creation";

const HTTP_NOT_FOUND = 404;
const HTTP_BAD_REQUEST = 400;
const HTTP_CONFLICT = 409;

const ACTIVE_STATUS: TenantSubscriptionStatus = "active";

const COMP_ICON = "i-ph-gift";
const ANY_AUDIENCE = "any";

const NOTIF_COMP_TITLE =
  "$saas.notifications.payload.complimentary_access_granted.title";
const NOTIF_COMP_DESC =
  "$saas.notifications.payload.complimentary_access_granted.description";

interface GrantFreeAccessBody {
  planId?: unknown;
  freeUntil?: string | null;
  /**
   * The operator ticked "I understand": required while a paid Stripe
   * subscription exists, since granting access cancels it.
   */
  acknowledgeCancellation?: unknown;
}

interface JoinResult {
  joined: true;
}

const JOIN = "$saas.workspace_detail.join";
const UNLIMITED_MEMBERS = -1;

/**
 * Joining takes no seat and shows the operator to the owner as platform
 * support; an operator already in the workspace is told so instead.
 */
function joinConfirmationDialog(
  view: WorkspaceOperatorView,
  isMember: boolean,
): ConfirmDialog {
  const maxMembers = view.plan?.maxMembers ?? UNLIMITED_MEMBERS;
  const params = {
    name: view.tenant.name,
    seats: view.seats.occupied,
    max: maxMembers === UNLIMITED_MEMBERS ? "∞" : maxMembers,
  };
  if (isMember)
    return {
      title: `${JOIN}.already_title`,
      description: `${JOIN}.already_description`,
      params,
      blocked: true,
    };
  return {
    title: `${JOIN}.title`,
    description: `${JOIN}.description`,
    params,
    icon: "i-ph-user-plus",
    color: "primary",
    confirmLabel: `${JOIN}.confirm`,
    impact: [
      { icon: "i-ph-armchair", label: `${JOIN}.impact_seat` },
      { icon: "i-ph-eye", label: `${JOIN}.impact_visible` },
      { icon: "i-ph-sign-out", label: `${JOIN}.impact_leave` },
    ],
  };
}

async function upsertFreeSubscription(
  tenantId: string,
  planId: string,
  freeUntil: Date | null,
  createdBy: string,
): Promise<void> {
  const tenantSubscriptionModel = GetModel(TenantSubscriptionModel, tenantId);
  const existing = await tenantSubscriptionModel.findOne();
  const operationId = randomUUID();
  if (existing)
    await tenantSubscriptionModel.beginTransition(existing, {
      operationId,
      kind: "change_plan",
      targetPlanId: planId,
      requestedAt: new Date(),
    });
  if (existing?.stripeSubscriptionId) {
    await getStripeClient().subscriptions.cancel(
      existing.stripeSubscriptionId,
      undefined,
      { idempotencyKey: `admin-grant-free:${operationId}` },
    );
  }
  // Clears the subscription/checkout refs and the self-refund claim
  // (refundRequestedAt), which re-arms self-refund eligibility.
  // stripeCustomerId is preserved on update so the existing Stripe customer
  // (and its saved payment methods) is reused when billing resumes instead of
  // orphaning it with a brand-new one.
  const payload = {
    planId,
    status: ACTIVE_STATUS,
    stripeSubscriptionId: null,
    stripeCheckoutSessionId: null,
    refundRequestedAt: null,
    freeUntil,
    isComplimentary: true,
    paidUsageStartedAt: null,
    paidUsagePeriods: closePaidUsagePeriods(existing, new Date()),
    updatedAt: new Date(),
  };
  if (existing) {
    await tenantSubscriptionModel.completeTransition(
      existing._id,
      operationId,
      payload,
    );
  } else {
    await tenantSubscriptionModel.insert([
      {
        ...payload,
        _id: tenantId,
        stripeCustomerId: null,
        createdBy,
        createdAt: new Date(),
      },
    ]);
  }
  await recomputeTenantBillingState(tenantId);
}

async function assertPlanIsAvailableForTenant(
  plan: Plan | undefined,
  tenantId: string,
): Promise<Plan> {
  assert(
    plan && !plan.isDeleted && plan.isActive,
    HTTP_BAD_REQUEST,
    "saas.errors.plan.invalid",
  );
  const billingInfo = await GetModel(
    TenantBillingInfoModel,
    tenantId,
  ).findOne();
  assert(
    plan.audience === ANY_AUDIENCE ||
      plan.audience === billingInfo?.customerType,
    HTTP_BAD_REQUEST,
    "saas.errors.plan.not_available_for_customer_type",
  );
  return plan;
}

/**
 * Granting complimentary access cancels a paid Stripe subscription for good;
 * the server refuses it unless the operator acknowledged exactly that.
 */
async function assertCancellationAcknowledged(
  tenantId: string,
  body: GrantFreeAccessBody,
): Promise<void> {
  const subscription = await GetModel(
    TenantSubscriptionModel,
    tenantId,
  ).findOne();
  assert(
    !subscription?.stripeSubscriptionId ||
      body.acknowledgeCancellation === true,
    HTTP_BAD_REQUEST,
    "saas.errors.workspace.cancellation_not_acknowledged",
  );
}

/** Platform admin actions that create workspaces and change their access. */
export class SaasWorkspacesAdminController extends Controller(
  "/api/saas/workspaces",
) {
  @Model(TenantModel)
  declare tenantModel: TenantModel;

  @Model(PlanModel)
  declare planModel: PlanModel;

  @Model(UserModel)
  declare userModel: UserModel;

  private async assertTenantExists(tenantId: string): Promise<void> {
    const tenant = await this.tenantModel.get(tenantId);
    assert(tenant, HTTP_NOT_FOUND, "saas.errors.workspace.not_found");
  }

  /** Who an owner e-mail belongs to, so the dialog says what will happen. */
  @Get("/owner-lookup")
  async lookUpOwnerEmail(
    @AuthOwnerOnly() _user: User,
    @Parameter("email", "query") email: unknown,
  ): Promise<OwnerLookup> {
    assert(
      typeof email === "string" && email.trim(),
      HTTP_BAD_REQUEST,
      "saas.errors.workspace_create.owner_email",
    );
    return lookUpOwner(email);
  }

  /**
   * Creates a workspace with the access model the operator chose: free on a
   * complimentary subscription, or waiting for its owner's first payment.
   */
  @Post("/create")
  async createWorkspace(
    @AuthOwnerOnly() user: User,
    @JSONBody() body: CreateWorkspaceBody,
  ): Promise<CreatedWorkspace> {
    const input = validateWorkspaceInput(body);
    await loadPlanForAccess(input);
    return createWorkspaceForOwner(input, user);
  }

  /** What complimentary access would end and stop, for the dialog. */
  @Get("/:tenantId/complimentary-impact")
  async getComplimentaryImpact(
    @AuthOwnerOnly() _user: User,
    @Parameter("tenantId", "param") tenantId: string,
  ): Promise<ComplimentaryImpact> {
    return loadComplimentaryImpact(tenantId);
  }

  @Post("/:tenantId/grant-free-access")
  async grantFreeAccess(
    @AuthOwnerOnly() user: User,
    @Parameter("tenantId", "param") tenantId: string,
    @JSONBody() body: GrantFreeAccessBody,
  ) {
    await this.assertTenantExists(tenantId);
    const planId = typeof body.planId === "string" ? body.planId : "";
    const plan = await assertPlanIsAvailableForTenant(
      planId ? await this.planModel.get(planId) : undefined,
      tenantId,
    );
    await assertCancellationAcknowledged(tenantId, body);
    const freeUntil = parseFutureDate(
      body.freeUntil,
      "saas.errors.workspace_create.free_until_past",
    );
    await runTenantLifecycleOperation(tenantId, () =>
      upsertFreeSubscription(tenantId, plan._id, freeUntil, user._id),
    );
    await notifyTenantOwners(tenantId, complimentaryAccessGrantedSubject, {
      icon: COMP_ICON,
      title: NOTIF_COMP_TITLE,
      description: NOTIF_COMP_DESC,
    });
    return { tenantId, planId: plan._id, freeUntil };
  }

  /** The confirmation of "Join as member", worded for this workspace. */
  @Get("/:tenantId/join-confirmation")
  async joinConfirmation(
    @AuthOwnerOnly() user: User,
    @Parameter("tenantId", "param") tenantId: string,
  ): Promise<ConfirmDialog> {
    const view = await loadWorkspaceOperatorView(tenantId);
    const membership = await GetModel(TenantMemberModel, tenantId).getByUser(
      user._id,
    );
    return joinConfirmationDialog(view, !!membership);
  }

  /**
   * Joins the workspace as platform support: no seat is taken, and the
   * workspace owner sees the operator listed as such.
   */
  @Post("/:tenantId/join")
  async joinAsMember(
    @AuthOwnerOnly() user: User,
    @Parameter("tenantId", "param") tenantId: string,
  ): Promise<JoinResult> {
    await this.assertTenantExists(tenantId);
    const existing = await GetModel(TenantMemberModel, tenantId).getByUser(
      user._id,
    );
    assert(!existing, HTTP_CONFLICT, "saas.errors.workspace.already_member");
    await applyTenantOwnership(this.userModel, user._id, tenantId, {
      roleIds: [],
      isTenantOwner: false,
    });
    return { joined: true };
  }
}
