import { Logging } from "@antelopejs/interface-core/logging";
import type { User } from "@antelopejs/interface-dms/auth/db";
import { invitationEmailFailedSubject, notifyUser } from "../notifications";
import { sendInvitationCommand } from "../operator-actions/invitation-commands";
import { workspaceDetailPath } from "../pages/platform/paths";
import {
  deliverInvitationEmail,
  type InvitationEmailDelivery,
  inviterNameOf,
} from "./invitations";

const LOG_PREFIX = "[dms-saas:owner-invitation]";
const FAILED_ICON = "i-ph-envelope-simple";
const FAILED_PAYLOAD = "$saas.notifications.payload.invitation_email_failed";

/** The owner invitation a new workspace e-mails, and who created it. */
export interface OwnerInvitationEmail {
  tenantId: string;
  workspaceName: string;
  email: string;
  inviteId: string;
  token: string;
  operator: User;
}

/**
 * The owner has no account yet, so the operator's language is the best guess at
 * theirs, as on the invitation itself.
 */
function deliver(
  invitation: OwnerInvitationEmail,
): Promise<InvitationEmailDelivery> {
  const { operator } = invitation;
  return deliverInvitationEmail(
    {
      email: invitation.email,
      token: invitation.token,
      firstname: null,
      lastname: null,
      language: operator.language,
    },
    {
      workspaceName: invitation.workspaceName,
      inviterName: inviterNameOf(operator),
    },
  );
}

/**
 * Tells the operator the owner was never e-mailed, linking to the workspace,
 * whose invitation card hands over the link to send them by hand.
 */
async function reportUndelivered(
  invitation: OwnerInvitationEmail,
): Promise<void> {
  await notifyUser(invitation.operator._id, invitationEmailFailedSubject, {
    icon: FAILED_ICON,
    title: `${FAILED_PAYLOAD}.title`,
    description: `${FAILED_PAYLOAD}.description`,
    params: { workspace: invitation.workspaceName, email: invitation.email },
    linkTo: workspaceDetailPath(invitation.tenantId),
    eventId: `invitation-email-failed:${invitation.inviteId}`,
  });
}

/**
 * E-mails a new workspace's owner invitation, journaled in the workspace's
 * activity, and tells the operator when it did not leave.
 *
 * @returns Whether the e-mail left
 */
export async function sendOwnerInvitationEmail(
  invitation: OwnerInvitationEmail,
): Promise<InvitationEmailDelivery> {
  const delivery = await sendInvitationCommand({
    tenantId: invitation.tenantId,
    inviteId: invitation.inviteId,
    actor: { id: invitation.operator._id, email: invitation.operator.email },
    email: invitation.email,
    send: () => deliver(invitation),
  });
  if (delivery === "failed") await reportUndelivered(invitation);
  return delivery;
}

/**
 * The same, without holding the operator's request: a mail server can take
 * minutes to time out, and the workspace already exists.
 */
export function sendOwnerInvitationEmailInBackground(
  invitation: OwnerInvitationEmail,
): void {
  void sendOwnerInvitationEmail(invitation).catch((error: unknown) => {
    Logging.Error(
      `${LOG_PREFIX} invitation of ${invitation.tenantId} needs a look`,
      error,
    );
  });
}
