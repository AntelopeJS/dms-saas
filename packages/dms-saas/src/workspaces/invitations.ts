import { assert } from "@antelopejs/interface-api-util";
import { Logging } from "@antelopejs/interface-core/logging";
import { GetModel } from "@antelopejs/interface-database-decorators";
import { sendAdminInviteEmail } from "@antelopejs/interface-dms/auth";
import { GetClientBaseUrl } from "@antelopejs/interface-dms/client-base-url";
import { type UserInvite, UserInviteModel } from "@antelopejs/interface-dms/db";
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

/**
 * Sends the invitation email and reports the outcome instead of throwing: the
 * invitation exists either way, and the caller tells the operator to hand the
 * link over when the email did not leave.
 */
export async function deliverInvitationEmail(
  invite: Pick<UserInvite, "email" | "token" | "firstname" | "lastname">,
): Promise<InvitationEmailDelivery> {
  try {
    await sendAdminInviteEmail(
      invite.email,
      invite.token,
      inviteeDisplayName(invite.firstname, invite.lastname),
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

/** Reissues the invitation and emails the new link. */
export async function resendInvitation(
  tenantId: string,
  inviteId: string,
): Promise<ReissuedInvitation> {
  const invite = await renewInvite(
    tenantId,
    await loadActionableInvite(tenantId, inviteId),
  );
  return { invite, emailDelivery: await deliverInvitationEmail(invite) };
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
