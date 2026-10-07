import {
  Context,
  Controller,
  Get,
  JSONBody,
  Parameter,
  Post,
  Put,
  type RequestContext,
} from "@antelopejs/interface-api";
import { assert } from "@antelopejs/interface-api-util";
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
} from "../../db";
import { type CardSetupIntent, createCardSetupIntent } from "../../stripe";
import { assertAdmissionOpen } from "../../config";
import { getSeatUsage } from "../../plans";
import { buildWorkspaceProjection } from "../../utils";
import type {
  CardDetails,
  MyWorkspaceRow,
  SelfServeCardUse,
  WorkspaceBillingProfile,
  WorkspaceCreateOptions,
  WorkspaceDeletionResult,
  WorkspaceOverview,
  WorkspaceProvisioningHandles,
} from "../../workspaces";
import {
  buildWorkspaceCreateOptions,
  buildWorkspaceOverview,
  cardRequirementOf,
  countPendingInvitations,
  ensurePlanIsAvailableForCustomer,
  listMyWorkspaces,
  normalizeWorkspaceName,
  provisionWorkspace,
  requestWorkspaceDeletion,
  resolveBillingProfileForNewWorkspace,
  resolveCardDetails,
  resolveDataRetentionDays,
  resolveFreeWorkspacesPerCard,
  resolveSelfServeCardUse,
  rollbackWorkspaceProvisioning,
  withCardHold,
} from "../../workspaces";

const HTTP_NOT_FOUND = 404;
const HTTP_CONFLICT = 409;
const HTTP_BAD_REQUEST = 400;

interface WorkspaceCreateBody {
  workspaceName?: string;
  planId: string;
  paymentMethodId?: string;
}

interface SelfServeCreationInput extends SelfServeCardUse {
  workspaceName: string;
  planId: string;
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

interface WorkspaceDeleteBody {
  /** The workspace name, typed by the owner to confirm. */
  confirmName?: string;
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

/**
 * The creation the owner asked for, once every rule of the chosen plan has
 * passed: the name, the audience of the plan, and the card it asks for.
 */
async function prepareSelfServeCreation(
  user: User,
  ctx: RequestContext,
  body: WorkspaceCreateBody,
  card: CardDetails,
): Promise<SelfServeCreationInput> {
  const workspaceName = normalizeWorkspaceName(body.workspaceName);
  const [billingProfile, freeWorkspacesPerCard] = await Promise.all([
    resolveBillingProfileForNewWorkspace(
      user._id,
      card,
      getRequestTenantId(ctx),
    ),
    resolveFreeWorkspacesPerCard(),
  ]);
  const plan = await ensurePlanIsAvailableForCustomer(
    body.planId,
    billingProfile.customerType,
  );
  const cardUse = await resolveSelfServeCardUse({
    requirement: cardRequirementOf(plan, freeWorkspacesPerCard),
    paymentMethodId: body.paymentMethodId,
    card,
    billingProfile,
    freeWorkspacesPerCard,
  });
  return { ...cardUse, workspaceName, planId: body.planId, billingProfile };
}

async function provisionSelfServeWorkspace(
  user: User,
  input: SelfServeCreationInput,
): Promise<CreatedWorkspace> {
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

export class SaasWorkspacesController extends Controller(
  "/api/saas/workspaces",
) {
  @Model(TenantModel)
  declare tenantModel: TenantModel;

  @Model(UserModel)
  declare userModel: UserModel;

  @Model(PlanModel)
  declare planModel: PlanModel;

  /** The switcher's list: every live workspace of the caller, current first. */
  @Get("/mine")
  async listMine(
    @AuthRawUser() user: User,
    @Context() ctx: RequestContext,
  ): Promise<MyWorkspaceRow[]> {
    return listMyWorkspaces(user._id, getRequestTenantId(ctx));
  }

  /**
   * What the creation form offers: the plans the caller may pick, each with
   * the card it asks for, and the per-card rule of free workspaces. Refuses a
   * closed admission before anything is filled in.
   */
  @Get("/create-options")
  async createOptions(
    @AuthRawUser() user: User,
    @Context() ctx: RequestContext,
  ): Promise<WorkspaceCreateOptions> {
    assertAdmissionOpen(user.owner);
    return buildWorkspaceCreateOptions(user, getRequestTenantId(ctx));
  }

  @Get("/setup-intent")
  async setupIntent(@AuthRawUser() user: User): Promise<CardSetupIntent> {
    assertAdmissionOpen(user.owner);
    return createCardSetupIntent();
  }

  /**
   * The card is read first, to hold it for the whole creation: two creations
   * racing with one card cannot both pass the per-card count of free
   * workspaces.
   */
  @Post("/")
  async createMine(
    @AuthRawUser() user: User,
    @Context() ctx: RequestContext,
    @JSONBody() body: WorkspaceCreateBody,
  ): Promise<CreatedWorkspace> {
    assertAdmissionOpen(user.owner);
    const card = await resolveCardDetails(body.paymentMethodId);
    return withCardHold(card.fingerprint, async () => {
      const input = await prepareSelfServeCreation(user, ctx, body, card);
      return provisionSelfServeWorkspace(user, input);
    });
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

  /** Feeds "At a glance" and the danger zone of the General page. */
  @Get("/current/overview")
  async getCurrentOverview(
    @AuthTenantOwner() user: User,
    @Context() ctx: RequestContext,
  ): Promise<WorkspaceOverview> {
    return buildWorkspaceOverview(getRequestTenantId(ctx), user._id);
  }

  @Put("/current")
  async renameCurrent(
    @AuthTenantOwner() _user: User,
    @Context() ctx: RequestContext,
    @JSONBody() body: WorkspaceRenameBody,
  ): Promise<RenamedWorkspace> {
    const tenantId = getRequestTenantId(ctx);
    const name = normalizeWorkspaceName(body.name);
    await this.tenantModel.update(tenantId, { name, updatedAt: new Date() });
    return { _id: tenantId, name };
  }

  /**
   * The typed name is checked here, not only in the dialog: a deletion is
   * irreversible once the retention period runs out.
   */
  @Post("/current/delete")
  async deleteCurrent(
    @AuthTenantOwner() _user: User,
    @Context() ctx: RequestContext,
    @JSONBody() body: WorkspaceDeleteBody,
  ): Promise<WorkspaceDeletionResult> {
    const tenantId = getRequestTenantId(ctx);
    const tenant = await this.tenantModel.get(tenantId);
    assert(tenant, HTTP_NOT_FOUND, "saas.errors.workspace.not_found");
    assert(
      body.confirmName?.trim() === tenant.name,
      HTTP_BAD_REQUEST,
      "saas.errors.workspace.delete_confirmation_mismatch",
    );
    return requestWorkspaceDeletion(tenantId);
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
