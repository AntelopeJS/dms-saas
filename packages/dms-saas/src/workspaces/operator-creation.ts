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
import { sendOwnerInvitationEmailInBackground } from "./owner-invitation-email";
import { createDefaultMemberRole } from "./default-member-role";
import { isString } from "../utils/primitive-guards";
import type { JsonValue } from "@antelopejs/interface-dms-saas/json";

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
  name?: JsonValue;
  planId?: JsonValue;
  ownerEmail?: JsonValue;
  access?: JsonValue;
  freeUntil?: JsonValue;
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
  invitationEmail: OwnerInvitationEmailState;
  access: WorkspaceAccessModel;
}

/**
 * The owner's invitation e-mail when the request answers: on its way, or
 * none for an owner who already had an account.
 */
export type OwnerInvitationEmailState = "sending" | null;

interface SubscriptionTerms {
  status: TenantSubscriptionStatus;
  isComplimentary: boolean;
  freeUntil: Date | null;
}

/**
 * The owner meets the existing checkout path: a subscription waiting for its
 * first payment on the chosen plan, which the access gate holds closed.
 */
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

function asNonEmptyString(value: JsonValue | undefined): string | null {
  return isString(value) && value.trim().length > 0 ? value.trim() : null;
}

function asAccessModel(
  value: JsonValue | undefined,
): WorkspaceAccessModel | null {
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

/**
 * The owner has no account yet, so the operator's language is the best guess at
 * theirs; the email follows the language stored on the invitation.
 */
async function addOwner(
  tenantId: string,
  input: ValidatedWorkspaceInput,
  operator: User,
): Promise<InviteUserToTenantResult> {
  return inviteUserToTenant({
    tenantId,
    email: input.ownerEmail,
    language: operator.language,
    roleIds: [],
    asTenantOwner: true,
  });
}

/**
 * Sent here rather than through `sendEmail`, which fires and forgets: the
 * operator is told when the owner never got the link. The request does not
 * wait for it.
 */
function emailOwnerInvitation(
  tenantId: string,
  owner: InviteUserToTenantResult,
  input: ValidatedWorkspaceInput,
  operator: User,
): OwnerInvitationEmailState {
  if (owner.kind !== "invited") return null;
  sendOwnerInvitationEmailInBackground({
    tenantId,
    workspaceName: input.name,
    email: input.ownerEmail,
    inviteId: owner.inviteId,
    token: owner.token,
    operator,
  });
  return "sending";
}

/**
 * Creates the workspace, its subscription and its owner (added or invited).
 * The owner has no account yet: their invitation is in the operator's
 * language, and so is the role they invite their own members with. The e-mail
 * goes last, as it is about a workspace complete with its plan.
 */
export async function createWorkspaceForOwner(
  input: ValidatedWorkspaceInput,
  operator: User,
): Promise<CreatedWorkspace> {
  const now = new Date();
  const [tenantId] = await GetModel(TenantModel).insert([
    { name: input.name, createdAt: now, updatedAt: now },
  ]);
  const owner = await addOwner(tenantId, input, operator);
  await createDefaultMemberRole(tenantId, operator.language);
  await insertSubscription(tenantId, input, operator);
  await recomputeTenantBillingState(tenantId);
  const invitationEmail = emailOwnerInvitation(
    tenantId,
    owner,
    input,
    operator,
  );
  return { tenantId, owner, invitationEmail, access: input.access };
}
