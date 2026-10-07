import { assert } from "@antelopejs/interface-api-util";
import { GetModel } from "@antelopejs/interface-database-decorators";
import { CROSS_INSTANCE } from "@antelopejs/interface-database";
import { TenantMemberModel, TenantModel } from "@antelopejs/interface-dms/db";
import {
  INVITE_EXPIRY_DAYS,
  type InviteUserToTenantResult,
  inviteUserToTenant,
} from "@antelopejs/interface-dms/invites";
import { type User, UserModel } from "@antelopejs/interface-dms/auth/db";
import { recomputeTenantBillingState } from "../billing-state";
import {
  type Plan,
  PlanModel,
  TenantSubscriptionModel,
  type TenantSubscriptionStatus,
} from "../db";
import { parseFutureDate } from "../utils/parse-future-date";
import {
  deliverInvitationEmail,
  type InvitationEmailDelivery,
  inviterNameOf,
} from "./invitations";

const HTTP_BAD_REQUEST = 400;

/**
 * How a workspace an operator creates is paid for: complimentary access
 * (nothing billed, optionally until a date), or by its owner, who meets the
 * checkout when they first sign in.
 */
const WORKSPACE_ACCESS_MODELS = ["complimentary", "owner_pays"] as const;
export type WorkspaceAccessModel = (typeof WORKSPACE_ACCESS_MODELS)[number];

/** The create-workspace form as the operator sends it. */
export interface CreateWorkspaceBody {
  name?: unknown;
  planId?: unknown;
  ownerEmail?: unknown;
  access?: unknown;
  freeUntil?: unknown;
}

/** The form, validated. */
export interface ValidatedWorkspaceInput {
  name: string;
  planId: string;
  ownerEmail: string;
  access: WorkspaceAccessModel;
  freeUntil: Date | null;
}

/** Who the owner e-mail belongs to, before the workspace is created. */
export type OwnerLookup =
  | { kind: "existing"; name: string; workspaces: number }
  | { kind: "new"; invitationDays: number };

/** What creating the workspace did, for the operator's confirmation. */
export interface CreatedWorkspace {
  tenantId: string;
  owner: InviteUserToTenantResult;
  invitationEmail: InvitationEmailDelivery | null;
  access: WorkspaceAccessModel;
}

interface SubscriptionTerms {
  status: TenantSubscriptionStatus;
  isComplimentary: boolean;
  freeUntil: Date | null;
}

// The owner meets the existing checkout path: a subscription waiting for its
// first payment on the chosen plan, which the access gate holds closed.
const SUBSCRIPTION_TERMS: Record<
  WorkspaceAccessModel,
  (input: ValidatedWorkspaceInput) => SubscriptionTerms
> = {
  complimentary: (input) => ({
    status: "active",
    isComplimentary: true,
    freeUntil: input.freeUntil,
  }),
  owner_pays: () => ({
    status: "pending_payment",
    isComplimentary: false,
    freeUntil: null,
  }),
};

function asNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function asAccessModel(value: unknown): WorkspaceAccessModel | null {
  return WORKSPACE_ACCESS_MODELS.find((model) => model === value) ?? null;
}

/** Validates the form; the plan and the access model are checked together later. */
export function validateWorkspaceInput(
  body: CreateWorkspaceBody,
): ValidatedWorkspaceInput {
  const name = asNonEmptyString(body.name);
  const planId = asNonEmptyString(body.planId);
  const ownerEmail = asNonEmptyString(body.ownerEmail);
  const access = asAccessModel(body.access);
  assert(name, HTTP_BAD_REQUEST, "saas.errors.workspace_create.name");
  assert(planId, HTTP_BAD_REQUEST, "saas.errors.workspace_create.plan");
  assert(
    ownerEmail,
    HTTP_BAD_REQUEST,
    "saas.errors.workspace_create.owner_email",
  );
  assert(access, HTTP_BAD_REQUEST, "saas.errors.workspace_create.access");
  const freeUntil =
    access === "complimentary"
      ? parseFutureDate(
          body.freeUntil,
          "saas.errors.workspace_create.free_until_past",
        )
      : null;
  return { name, planId, ownerEmail, access, freeUntil };
}

/**
 * The plan must be on sale; an owner can only pay for a plan Stripe bills,
 * so "owner pays" needs a priced plan synced with Stripe.
 */
export async function loadPlanForAccess(
  input: ValidatedWorkspaceInput,
): Promise<Plan> {
  const plan = await GetModel(PlanModel).get(input.planId);
  assert(
    plan && !plan.isDeleted && plan.isActive,
    HTTP_BAD_REQUEST,
    "saas.errors.plan.not_available",
  );
  assert(
    input.access !== "owner_pays" ||
      (plan.price > 0 && !!plan.paymentProviderRefs?.stripePriceId),
    HTTP_BAD_REQUEST,
    "saas.errors.workspace_create.owner_pays_needs_paid_plan",
  );
  return plan;
}

/** An existing account is added as owner; a new e-mail gets an invitation. */
export async function lookUpOwner(email: string): Promise<OwnerLookup> {
  const user = await GetModel(UserModel).getByEmail(email);
  if (!user) return { kind: "new", invitationDays: INVITE_EXPIRY_DAYS };
  const memberships = await GetModel(
    TenantMemberModel,
    CROSS_INSTANCE,
  ).listByUserWithTenantIds(user._id);
  return {
    kind: "existing",
    name: user.name || user.email,
    workspaces: memberships.length,
  };
}

async function insertSubscription(
  tenantId: string,
  input: ValidatedWorkspaceInput,
  operator: User,
): Promise<void> {
  const now = new Date();
  await GetModel(TenantSubscriptionModel, tenantId).insert([
    {
      ...SUBSCRIPTION_TERMS[input.access](input),
      planId: input.planId,
      stripeCustomerId: null,
      stripeSubscriptionId: null,
      stripeCheckoutSessionId: null,
      createdBy: operator._id,
      paidUsageStartedAt: null,
      paidUsagePeriods: [],
      createdAt: now,
      updatedAt: now,
    },
  ]);
}

async function inviteOwner(
  tenantId: string,
  input: ValidatedWorkspaceInput,
  operator: User,
): Promise<Omit<CreatedWorkspace, "access">> {
  // The owner has no account yet, so the operator's language is the best
  // guess at theirs; the email follows the language stored on the invitation.
  const language = operator.language;
  const owner = await inviteUserToTenant({
    tenantId,
    email: input.ownerEmail,
    language,
    roleIds: [],
    asTenantOwner: true,
  });
  // Sent here rather than through `sendEmail`, which fires and forgets: the
  // operator has to learn that the owner never got the link.
  const invitationEmail =
    owner.kind === "invited"
      ? await deliverInvitationEmail(
          {
            email: input.ownerEmail,
            token: owner.token,
            firstname: null,
            lastname: null,
            language,
          },
          { workspaceName: input.name, inviterName: inviterNameOf(operator) },
        )
      : null;
  return { tenantId, owner, invitationEmail };
}

/** Creates the workspace, its subscription and its owner (added or invited). */
export async function createWorkspaceForOwner(
  input: ValidatedWorkspaceInput,
  operator: User,
): Promise<CreatedWorkspace> {
  const now = new Date();
  const [tenantId] = await GetModel(TenantModel).insert([
    { name: input.name, createdAt: now, updatedAt: now },
  ]);
  const created = await inviteOwner(tenantId, input, operator);
  await insertSubscription(tenantId, input, operator);
  await recomputeTenantBillingState(tenantId);
  return { ...created, access: input.access };
}
