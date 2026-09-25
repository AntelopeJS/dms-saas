import { assert } from "@antelopejs/interface-api-util";
import { Logging } from "@antelopejs/interface-core/logging";
import { GetModel } from "@antelopejs/interface-database-decorators";
import {
  type AdminInviteEmailContext,
  sendAdminInviteEmail,
} from "@antelopejs/interface-dms/auth";
import type { User } from "@antelopejs/interface-dms/auth/db";
import { GetClientBaseUrl } from "@antelopejs/interface-dms/client-base-url";
import {
  TenantModel,
  type UserInvite,
  UserInviteModel,
} from "@antelopejs/interface-dms/db";
import {
  assertInviteReady,
  loadInviteForAction,
} from "@antelopejs/interface-dms/invite-resolution";
import {
  createUserInviteToken,
  inviteeDisplayName,
} from "@antelopejs/interface-dms/invites";

const HTTP_NOT_FOUND = 404;
const SIGNUP_PATH = "/auth/signup";

export type InvitationEmailDelivery = "sent" | "failed";

export type InvitationStatus = "pending" | "expired";

export interface InvitationLink {
  link: string;
  expiresAt: Date;
}

/** Who invites and into which workspace, as the invitation email names them. */
interface InvitationSender {
  workspaceName?: string;
  inviterName?: string;
}

type DeliverableInvitation = Pick<
  UserInvite,
  "email" | "token" | "firstname" | "lastname" | "language"
>;

export interface ReissuedInvitation {
  invite: UserInvite;
  emailDelivery: InvitationEmailDelivery;
}

/** Whether the invitee can still redeem the invitation's token. */
export function invitationStatusOf(
  invite: Pick<UserInvite, "expiresAt">,
  now: Date = new Date(),
): InvitationStatus {
  return invite.expiresAt.getTime() > now.getTime() ? "pending" : "expired";
}

/**
 * The signup link the invitation email carries, built the same way so a link
 * handed over by an operator lands on the same screen as the email's.
 */
export async function buildInvitationLink(
  invite: Pick<UserInvite, "email" | "token" | "firstname" | "lastname">,
): Promise<string> {
  const params = new URLSearchParams({
    token: invite.token,
    email: invite.email,
  });
  const name = inviteeDisplayName(invite.firstname, invite.lastname);
  if (name) params.set("name", name);
  const baseUrl = (await GetClientBaseUrl()) ?? "";
  return `${baseUrl}${SIGNUP_PATH}?${params.toString()}`;
}

/** The operator as an invitation email names them; nameless accounts stay unnamed. */
export function inviterNameOf(user: Pick<User, "name">): string | undefined {
  return user.name?.trim() || undefined;
}

function invitationEmailContext(
  invite: DeliverableInvitation,
  sender: InvitationSender,
): AdminInviteEmailContext {
  return {
    workspaceName: sender.workspaceName,
    inviterName: sender.inviterName,
    language: invite.language,
  };
}

/**
 * Sends the invitation email and reports the outcome instead of throwing: the
 * invitation exists either way, and the caller tells the operator to hand the
 * link over when the email did not leave. The email is written in the
 * invitation's language and names the workspace and inviter when known.
 */
export async function deliverInvitationEmail(
  invite: DeliverableInvitation,
  sender: InvitationSender = {},
): Promise<InvitationEmailDelivery> {
  try {
    await sendAdminInviteEmail(
      invite.email,
      invite.token,
      inviteeDisplayName(invite.firstname, invite.lastname),
      invitationEmailContext(invite, sender),
    );
    return "sent";
  } catch (error) {
    Logging.Error(
      `[dms-saas] invitation email to "${invite.email}" could not be sent:`,
      error,
    );
    return "failed";
  }
}

/** Invitations of the workspace its invitees can still redeem. */
export async function countPendingInvitations(
  tenantId: string,
  now: Date = new Date(),
): Promise<number> {
  const invites = await GetModel(UserInviteModel, tenantId).getAll();
  return invites.filter(
    (invite) => invitationStatusOf(invite, now) === "pending",
  ).length;
}

/** Oldest unaccepted invitation that would make its invitee a workspace owner. */
export async function findPendingOwnerInvite(
  tenantId: string,
): Promise<UserInvite | undefined> {
  const invites = await GetModel(UserInviteModel, tenantId).getAll();
  return invites
    .filter((invite) => invite.asTenantOwner)
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())[0];
}

async function loadActionableInvite(
  tenantId: string,
  inviteId: string,
): Promise<UserInvite> {
  const invite = await loadInviteForAction(tenantId, inviteId);
  assert(invite, HTTP_NOT_FOUND, "saas.errors.invitations.not_found");
  await assertInviteReady(tenantId, invite);
  return invite;
}

/** Same reissue as the DMS "Resend": a fresh token and expiry, same content. */
async function renewInvite(
  tenantId: string,
  invite: UserInvite,
): Promise<UserInvite> {
  const { inviteId } = await createUserInviteToken({
    tenantId,
    replacesInvite: invite,
    email: invite.email,
    firstname: invite.firstname,
    lastname: invite.lastname,
    language: invite.language,
    roleIds: invite.roles_ids,
    asTenantOwner: invite.asTenantOwner,
    skipEmailValidation: invite.skipEmailValidation,
    extensions: invite.extensions ?? undefined,
    replacementReason: "resent",
  });
  const renewed = await GetModel(UserInviteModel, tenantId).get(inviteId);
  if (!renewed) throw new Error("Renewed invitation was not persisted");
  return renewed;
}

async function workspaceNameOf(tenantId: string): Promise<string | undefined> {
  const tenant = await GetModel(TenantModel).get(tenantId);
  return tenant?.name || undefined;
}

/**
 * Reissues the invitation and emails the new link. The inviter is whoever
 * resends it: the invitation does not record who first sent it.
 */
export async function resendInvitation(
  tenantId: string,
  inviteId: string,
  inviterName?: string,
): Promise<ReissuedInvitation> {
  const invite = await renewInvite(
    tenantId,
    await loadActionableInvite(tenantId, inviteId),
  );
  const emailDelivery = await deliverInvitationEmail(invite, {
    workspaceName: await workspaceNameOf(tenantId),
    inviterName,
  });
  return { invite, emailDelivery };
}

/**
 * The link to hand over to the invitee. The stored token is reused while it
 * can still be redeemed, so a link already sent keeps working; an expired
 * invitation is renewed first, since its token would be refused at signup.
 */
export async function resolveInvitationLink(
  tenantId: string,
  inviteId: string,
): Promise<InvitationLink> {
  const stored = await loadActionableInvite(tenantId, inviteId);
  const invite =
    invitationStatusOf(stored) === "pending"
      ? stored
      : await renewInvite(tenantId, stored);
  return {
    link: await buildInvitationLink(invite),
    expiresAt: invite.expiresAt,
  };
}
