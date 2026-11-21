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
  completeInviteResolution,
  decideInvite,
  loadInviteForAction,
} from "@antelopejs/interface-dms/invite-resolution";
import {
  inviteeDisplayName,
  reissueUserInvite,
} from "@antelopejs/interface-dms/invites";

const HTTP_NOT_FOUND = 404;
const SIGNUP_PATH = "/auth/signup";
/** The DMS's own reason when a workspace admin cancels an invitation. */
const REVOKED_REASON = "cancelled";

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

/**
 * The invitation row stores only a digest of its token, so the token to mail
 * travels beside it.
 */
type DeliverableInvitation = Pick<
  UserInvite,
  "email" | "firstname" | "lastname" | "language"
> & { token: string };

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
  invite: Pick<UserInvite, "email" | "firstname" | "lastname">,
  token: string,
): Promise<string> {
  const params = new URLSearchParams({
    token,
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

/** A reissued invitation and the token of its new link, shown only once. */
interface RenewedInvite {
  invite: UserInvite;
  token: string;
}

/** Same reissue as the DMS "Resend": a fresh token and expiry, same content. */
async function renewInvite(
  tenantId: string,
  invite: UserInvite,
): Promise<RenewedInvite> {
  const { inviteId, token } = await reissueUserInvite(tenantId, invite);
  const renewed = await GetModel(UserInviteModel, tenantId).get(inviteId);
  if (!renewed) throw new Error("Renewed invitation was not persisted");
  return { invite: renewed, token };
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
  const { invite, token } = await renewInvite(
    tenantId,
    await loadActionableInvite(tenantId, inviteId),
  );
  const emailDelivery = await deliverInvitationEmail(
    {
      email: invite.email,
      firstname: invite.firstname,
      lastname: invite.lastname,
      language: invite.language,
      token,
    },
    {
      workspaceName: await workspaceNameOf(tenantId),
      inviterName,
    },
  );
  return { invite, emailDelivery };
}

/**
 * The link to hand over to the invitee. Only the digest of a token is stored,
 * so every call reissues the invitation: the new link works and the one given
 * before stops working.
 */
export async function resolveInvitationLink(
  tenantId: string,
  inviteId: string,
): Promise<InvitationLink> {
  const { invite, token } = await renewInvite(
    tenantId,
    await loadActionableInvite(tenantId, inviteId),
  );
  return {
    link: await buildInvitationLink(invite, token),
    expiresAt: invite.expiresAt,
  };
}

/**
 * Withdraws an invitation the way a workspace admin cancels one in the DMS:
 * its token stops working and the seat it held is released.
 */
export async function revokeInvitation(
  tenantId: string,
  inviteId: string,
): Promise<UserInvite> {
  const invite = await loadActionableInvite(tenantId, inviteId);
  await cancelInvitation(tenantId, invite);
  return invite;
}

/**
 * Cancels a loaded invitation through the DMS resolution: its token stops
 * working, its extensions are cleaned up and the DMS hooks run.
 *
 * @param tenantId Workspace of the invitation
 * @param invite The invitation
 */
export async function cancelInvitation(
  tenantId: string,
  invite: UserInvite,
): Promise<void> {
  const resolution = await decideInvite({
    tenantId,
    invite,
    reason: REVOKED_REASON,
  });
  await completeInviteResolution(resolution);
}
