import {
  Context,
  Controller,
  Delete,
  Get,
  JSONBody,
  Parameter,
  Post,
  Put,
  type RequestContext,
} from "@antelopejs/interface-api";
import { assert } from "@antelopejs/interface-api-util";
import { CROSS_INSTANCE } from "@antelopejs/interface-database";
import { GetModel, Model } from "@antelopejs/interface-database-decorators";
import {
  type TenantMember,
  TenantMemberModel,
  TenantModel,
} from "@antelopejs/interface-dms/db";
import { AuthTenantOwner } from "@antelopejs/interface-dms/guards";
import { getRequestTenantId } from "@antelopejs/interface-dms/request-tenant";
import { applyTenantOwnership } from "@antelopejs/interface-dms/tenant-ownership";
import { AuthOwnerOnly, AuthRawUser } from "@antelopejs/interface-dms/auth";
import { type User, UserModel } from "@antelopejs/interface-dms/auth/db";
import {
  type CreditNote,
  CreditNoteModel,
  type Invoice,
  InvoiceModel,
  type Plan,
  PlanModel,
  type TenantBillingInfo,
  TenantBillingInfoModel,
  type TenantSubscription,
  TenantSubscriptionModel,
  type TenantSubscriptionStatus,
} from "../../db";
import { type CardSetupIntent, createCardSetupIntent } from "../../stripe";
import { assertAdmissionOpen } from "../../config";
import { getSeatUsage } from "../../plans";
import { buildWorkspaceProjection } from "../../utils";
import type {
  CardDetails,
  FreePlanAvailability,
  WorkspaceBillingProfile,
  WorkspaceDeletionResult,
  WorkspaceProvisioningHandles,
} from "../../workspaces";
import {
  assertBillingCountry,
  assertFreePlanAllowedForCard,
  countPendingInvitations,
  ensurePlanIsAvailableForCustomer,
  provisionWorkspace,
  requestWorkspaceDeletion,
  resolveBillingProfileForNewWorkspace,
  resolveCardDetails,
  resolveDataRetentionDays,
  resolveFreePlanAvailabilityForUser,
  rollbackWorkspaceProvisioning,
} from "../../workspaces";

const HTTP_NOT_FOUND = 404;
const HTTP_CONFLICT = 409;
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

interface WorkspaceCreateOptions {
  freePlan: FreePlanAvailability;
}

interface WorkspaceCreateBody {
  workspaceName?: string;
  planId: string;
  paymentMethodId?: string;
}

interface SelfServeCreationInput {
  workspaceName: string;
  paymentMethodId: string;
  planId: string;
  card: CardDetails;
  billingProfile: WorkspaceBillingProfile;
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

interface WorkspaceMemberRow {
  _id: string;
  userId: string;
  email: string;
  name: string | null;
  isTenantOwner: boolean;
  joinedAt: Date;
}

async function buildMemberRows(
  members: TenantMember[],
  userModel: UserModel,
): Promise<WorkspaceMemberRow[]> {
  const memberUsers = await Promise.all(
    members.map((m) => userModel.get(m.userId)),
  );
  return members.map((m, i) => ({
    _id: m._id,
    userId: m.userId,
    email: memberUsers[i]?.email ?? m.userId,
    name: memberUsers[i]?.name ?? null,
    isTenantOwner: m.isTenantOwner,
    joinedAt: m.joinedAt,
  }));
}

function sortByIssuedAtDesc<T extends { issuedAt: Date | string }>(
  items: readonly T[],
): T[] {
  return items
    .slice()
    .sort((a, b) => +new Date(b.issuedAt) - +new Date(a.issuedAt));
}

interface WorkspaceRelations {
  subscription: TenantSubscription | undefined;
  billingInfo: TenantBillingInfo | undefined;
  members: TenantMember[];
  invoices: Invoice[];
  creditNotes: CreditNote[];
  plan: Plan | null;
}

async function loadWorkspaceRelations(
  tenantId: string,
  planModel: PlanModel,
): Promise<WorkspaceRelations> {
  const tenantSubscriptionModel = GetModel(TenantSubscriptionModel, tenantId);
  const tenantBillingInfoModel = GetModel(TenantBillingInfoModel, tenantId);
  const memberModel = GetModel(TenantMemberModel, tenantId);
  const invoiceModel = GetModel(InvoiceModel, tenantId);
  const creditNoteModel = GetModel(CreditNoteModel, tenantId);
  const [subscription, billingInfo, members, invoices, creditNotes] =
    await Promise.all([
      tenantSubscriptionModel.findOne(),
      tenantBillingInfoModel.findOne(),
      memberModel.listAll(),
      invoiceModel.getAllInvoices(),
      creditNoteModel.getAll(),
    ]);
  const plan = subscription?.planId
    ? ((await planModel.get(subscription.planId)) ?? null)
    : null;
  return { subscription, billingInfo, members, invoices, creditNotes, plan };
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

  @Get("/create-options")
  async createOptions(
    @AuthRawUser() user: User,
  ): Promise<WorkspaceCreateOptions> {
    assertAdmissionOpen(user.owner);
    return { freePlan: await resolveFreePlanAvailabilityForUser(user._id) };
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
    assert(
      body.paymentMethodId,
      HTTP_BAD_REQUEST,
      "saas.errors.workspace.payment_method_required",
    );
    const card = await resolveCardDetails(body.paymentMethodId);
    const billingProfile = await resolveBillingProfileForNewWorkspace(
      user._id,
      card,
      getRequestTenantId(ctx),
    );
    assertBillingCountry(billingProfile.address);
    const plan = await ensurePlanIsAvailableForCustomer(
      body.planId,
      billingProfile.customerType,
    );
    await assertFreePlanAllowedForCard(plan, card.fingerprint);
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

  @Get("/:id")
  async getDetail(@AuthOwnerOnly() _user: User, @Parameter("id") id: string) {
    const tenant = await this.tenantModel.get(id);
    assert(tenant, HTTP_NOT_FOUND, "saas.errors.workspace.not_found");

    const { subscription, billingInfo, members, invoices, creditNotes, plan } =
      await loadWorkspaceRelations(id, this.planModel);
    const [memberRows, pendingInvitationsCount, seats] = await Promise.all([
      buildMemberRows(members, this.userModel),
      countPendingInvitations(id),
      getSeatUsage(id),
    ]);

    const projection = buildWorkspaceProjection({
      tenant,
      subscription,
      billingInfo,
      plan,
      membersCount: members.length,
      invoices,
      now: new Date(),
    });

    return {
      _id: projection._id,
      name: projection.name,
      createdAt: projection.createdAt,
      status: projection.status,
      planId: projection.planId,
      planName: projection.planName,
      currency: projection.currency,
      mrr: projection.mrr,
      // Counted as the customer's seats count them: platform support is
      // announced apart, so the two numbers match the members page.
      membersCount: seats.members,
      platformSupportCount: seats.platformSupport.length,
      // Shown beside the member count: a workspace created for an owner who
      // has not signed up yet has no member, only this invitation.
      pendingInvitationsCount,
      subscription: subscription ?? null,
      billingInfo: billingInfo ?? null,
      members: memberRows,
      invoices: sortByIssuedAtDesc(invoices),
      creditNotes: sortByIssuedAtDesc(creditNotes),
    };
  }

  @Post("/:id/join")
  async joinAsMember(@AuthOwnerOnly() user: User, @Parameter("id") id: string) {
    const tenant = await this.tenantModel.get(id);
    assert(tenant, HTTP_NOT_FOUND, "saas.errors.workspace.not_found");

    const memberModel = GetModel(TenantMemberModel, id);
    const existing = await memberModel.getByUser(user._id);
    assert(!existing, HTTP_CONFLICT, "saas.workspaces.join.already_member");

    await applyTenantOwnership(this.userModel, user._id, id, {
      roleIds: [],
      isTenantOwner: false,
    });
    return { joined: true };
  }
}
