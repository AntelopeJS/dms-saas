import {
  Context,
  Controller,
  Delete,
  Get,
  JSONBody,
  Post,
  Put,
  type RequestContext,
} from "@antelopejs/interface-api";
import { assert } from "@antelopejs/interface-api-util";
import { CROSS_INSTANCE } from "@antelopejs/interface-database";
import { GetModel, Model } from "@antelopejs/interface-database-decorators";
import { TenantMemberModel, TenantModel } from "@antelopejs/interface-dms/db";
import { AuthTenantOwner } from "@antelopejs/interface-dms/guards";
import { getRequestTenantId } from "@antelopejs/interface-dms/request-tenant";
import { AuthRawUser } from "@antelopejs/interface-dms/auth";
import { type User, UserModel } from "@antelopejs/interface-dms/auth/db";
import {
  type Plan,
  PlanModel,
  TenantSubscriptionModel,
  type TenantSubscriptionStatus,
} from "../../db";
import { type CardSetupIntent, createCardSetupIntent } from "../../stripe";
import { assertAdmissionOpen } from "../../config";
import type {
  CardDetails,
  WorkspaceBillingProfile,
  WorkspaceDeletionResult,
  WorkspaceProvisioningHandles,
} from "../../workspaces";
import {
  assertBillingCountry,
  ensurePlanIsAvailableForCustomer,
  isFreePlan,
  provisionWorkspace,
  requestWorkspaceDeletion,
  resolveBillingProfileForNewWorkspace,
  resolveCardDetails,
  resolveDataRetentionDays,
  rollbackWorkspaceProvisioning,
} from "../../workspaces";

const HTTP_NOT_FOUND = 404;
const HTTP_BAD_REQUEST = 400;

const CANCELLED_STATUS: TenantSubscriptionStatus = "cancelled";

interface WorkspaceSubscriptionSummary {
  planName: string | null;
  status: TenantSubscriptionStatus | null;
}

interface MyWorkspaceRow {
  _id: string;
  name: string;
  planName: string | null;
  isCurrent: boolean;
}

interface WorkspaceCreateBody {
  workspaceName?: string;
  planId: string;
  paymentMethodId?: string;
}

interface SelfServeCreationInput {
  workspaceName: string;
  paymentMethodId?: string;
  planId: string;
  card: CardDetails;
  billingProfile: WorkspaceBillingProfile;
}

/**
 * A free plan goes on without a card, and then without a billing address:
 * nothing is billed, and an upgrade collects both through Stripe Checkout.
 * A card, even on a free plan, still has to come with a supported country.
 */
function assertPaymentReadiness(
  plan: Plan,
  paymentMethodId: string | undefined,
  billingProfile: WorkspaceBillingProfile,
): void {
  if (paymentMethodId) {
    assertBillingCountry(billingProfile.address);
    return;
  }
  assert(
    isFreePlan(plan),
    HTTP_BAD_REQUEST,
    "saas.errors.workspace.payment_method_required",
  );
}

interface CreatedWorkspace {
  tenantId: string;
}

interface CurrentWorkspace {
  _id: string;
  name: string;
  retentionDays: number;
}

interface WorkspaceRenameBody {
  name?: string;
}

interface RenamedWorkspace {
  _id: string;
  name: string;
}

export class SaasWorkspacesController extends Controller(
  "/api/saas/workspaces",
) {
  @Model(TenantModel)
  declare tenantModel: TenantModel;

  @Model(UserModel)
  declare userModel: UserModel;

  @Model(PlanModel)
  declare planModel: PlanModel;

  private async resolveSubscriptionSummaries(
    tenantIds: string[],
  ): Promise<Map<string, WorkspaceSubscriptionSummary>> {
    const subscriptions = await Promise.all(
      tenantIds.map((tenantId) =>
        GetModel(TenantSubscriptionModel, tenantId).findOne(),
      ),
    );
    // The map yields `Promise<Plan> | null`, and the rule reads the null as a
    // non-thenable that should not reach an aggregator. Promise.all accepts it:
    // a non-promise entry resolves to itself, which is exactly the `null` the
    // lookup below expects at that index. Wrapping it in Promise.resolve would
    // only add a tick.
    const plans = await Promise.all(
      // oxlint-disable-next-line typescript/await-thenable
      subscriptions.map((subscription) =>
        subscription?.planId ? this.planModel.get(subscription.planId) : null,
      ),
    );
    return new Map(
      tenantIds.map((tenantId, index) => [
        tenantId,
        {
          planName: plans[index]?.name ?? null,
          status: subscriptions[index]?.status ?? null,
        },
      ]),
    );
  }

  @Get("/mine")
  async listMine(
    @AuthRawUser() user: User,
    @Context() ctx: RequestContext,
  ): Promise<MyWorkspaceRow[]> {
    const currentTenantId = getRequestTenantId(ctx);

    const memberModel = GetModel(TenantMemberModel, CROSS_INSTANCE);
    const memberships = await memberModel.listByUserWithTenantIds(user._id);
    if (memberships.length === 0) return [];

    const tenants = await this.tenantModel.getMany(
      memberships.map((m) => m.tenantId),
    );
    const summaries = await this.resolveSubscriptionSummaries(
      tenants.map((tenant) => tenant._id),
    );
    return (
      tenants
        // A cancelled workspace lives on until the retention cron deletes it,
        // but switching to it only reaches the access-restricted screen.
        .filter(
          (tenant) => summaries.get(tenant._id)?.status !== CANCELLED_STATUS,
        )
        .map((tenant) => ({
          _id: tenant._id,
          name: tenant.name,
          planName: summaries.get(tenant._id)?.planName ?? null,
          isCurrent: tenant._id === currentTenantId,
        }))
    );
  }

  /** Lets the creation form report closed admission before anything is filled in. */
  @Get("/create-options")
  async createOptions(@AuthRawUser() user: User): Promise<void> {
    assertAdmissionOpen(user.owner);
  }

  @Get("/setup-intent")
  async setupIntent(@AuthRawUser() user: User): Promise<CardSetupIntent> {
    assertAdmissionOpen(user.owner);
    return createCardSetupIntent();
  }

  private async prepareSelfServeCreation(
    user: User,
    ctx: RequestContext,
    body: WorkspaceCreateBody,
  ): Promise<SelfServeCreationInput> {
    assertAdmissionOpen(user.owner);
    const workspaceName = body.workspaceName?.trim();
    assert(
      workspaceName,
      HTTP_BAD_REQUEST,
      "saas.errors.workspace.name_required",
    );
    const card = await resolveCardDetails(body.paymentMethodId);
    const billingProfile = await resolveBillingProfileForNewWorkspace(
      user._id,
      card,
      getRequestTenantId(ctx),
    );
    const plan = await ensurePlanIsAvailableForCustomer(
      body.planId,
      billingProfile.customerType,
    );
    assertPaymentReadiness(plan, body.paymentMethodId, billingProfile);
    return {
      workspaceName,
      paymentMethodId: body.paymentMethodId,
      planId: body.planId,
      card,
      billingProfile,
    };
  }

  @Post("/")
  async createMine(
    @AuthRawUser() user: User,
    @Context() ctx: RequestContext,
    @JSONBody() body: WorkspaceCreateBody,
  ): Promise<CreatedWorkspace> {
    const input = await this.prepareSelfServeCreation(user, ctx, body);
    const handles: WorkspaceProvisioningHandles = { userId: user._id };
    try {
      const { tenantId } = await provisionWorkspace({
        userId: user._id,
        payload: {
          ...input.billingProfile,
          workspaceName: input.workspaceName,
          planId: input.planId,
          paymentMethodId: input.paymentMethodId,
        },
        stripeCustomerProfile: {
          ...input.billingProfile,
          email: user.email,
          fallbackName: user.name,
        },
        card: input.card,
        handles,
      });
      return { tenantId };
    } catch (error) {
      await rollbackWorkspaceProvisioning(handles);
      throw error;
    }
  }

  /**
   * Read by the billing page, the recovery surface of a blocked workspace:
   * the name and retention period are the workspace's own identity, nothing
   * the access gate protects. Renaming and deleting stay gated.
   */
  @Get("/current")
  async getCurrent(
    @AuthTenantOwner({ bypassTenantAccessGate: true }) _user: User,
    @Context() ctx: RequestContext,
  ): Promise<CurrentWorkspace> {
    const tenantId = getRequestTenantId(ctx);
    const tenant = await this.tenantModel.get(tenantId);
    assert(tenant, HTTP_NOT_FOUND, "saas.errors.workspace.not_found");
    return {
      _id: tenant._id,
      name: tenant.name,
      retentionDays: await resolveDataRetentionDays(),
    };
  }

  @Put("/current")
  async renameCurrent(
    @AuthTenantOwner() _user: User,
    @Context() ctx: RequestContext,
    @JSONBody() body: WorkspaceRenameBody,
  ): Promise<RenamedWorkspace> {
    const tenantId = getRequestTenantId(ctx);
    const name = body.name?.trim();
    assert(name, HTTP_BAD_REQUEST, "saas.errors.workspace.name_required");
    await this.tenantModel.update(tenantId, { name, updatedAt: new Date() });
    return { _id: tenantId, name };
  }

  @Delete("/current")
  async deleteCurrent(
    @AuthTenantOwner() _user: User,
    @Context() ctx: RequestContext,
  ): Promise<WorkspaceDeletionResult> {
    return requestWorkspaceDeletion(getRequestTenantId(ctx));
  }
}
