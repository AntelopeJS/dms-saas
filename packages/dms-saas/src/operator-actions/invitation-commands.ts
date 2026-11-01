import {
  type InvitationEmailDelivery,
  type InvitationLink,
  type ReissuedInvitation,
  resendInvitation,
  resolveInvitationLink,
  revokeInvitation,
} from "../workspaces/invitations";
import type { OperatorActor } from "./journal";
import { runJournaled } from "./one-shot";

export interface InvitationCommandInput {
  tenantId: string;
  inviteId: string;
  actor: OperatorActor;
}

export interface ResendInvitationCommandInput extends InvitationCommandInput {
  inviterName?: string;
}

export interface SendInvitationCommandInput extends InvitationCommandInput {
  email: string;
  send: () => Promise<InvitationEmailDelivery>;
}

/**
 * Sends an invitation's first e-mail, journaled with its outcome: the
 * workspace's activity says whether its owner was told.
 */
export async function sendInvitationCommand(
  input: SendInvitationCommandInput,
): Promise<InvitationEmailDelivery> {
  return runJournaled(
    { ...input, details: { inviteId: input.inviteId } },
    {
      action: "invitation.send",
      run: input.send,
      detailsOf: (emailDelivery) => ({ email: input.email, emailDelivery }),
    },
  );
}

/**
 * Reissues a pending invitation and emails it, journaled like every operator
 * action so the back office keeps a trace of who re-sent what.
 */
export async function resendInvitationCommand(
  input: ResendInvitationCommandInput,
): Promise<ReissuedInvitation> {
  return runJournaled(
    { ...input, details: { inviteId: input.inviteId } },
    {
      action: "invitation.resend",
      run: () =>
        resendInvitation(input.tenantId, input.inviteId, input.inviterName),
      detailsOf: ({ invite, emailDelivery }) => ({
        email: invite.email,
        emailDelivery,
      }),
    },
  );
}

/**
 * Hands the invitation's signup link to an operator. The link is a bearer
 * credential for the workspace, so every disclosure is journaled — without the
 * token itself.
 */
export async function copyInvitationLinkCommand(
  input: InvitationCommandInput,
): Promise<InvitationLink> {
  return runJournaled(
    { ...input, details: { inviteId: input.inviteId } },
    {
      action: "invitation.link_copy",
      run: () => resolveInvitationLink(input.tenantId, input.inviteId),
      detailsOf: ({ expiresAt }) => ({ expiresAt: expiresAt.toISOString() }),
    },
  );
}

/** Withdraws a pending or expired invitation, journaled with its invitee. */
export async function revokeInvitationCommand(
  input: InvitationCommandInput,
): Promise<void> {
  await runJournaled(
    { ...input, details: { inviteId: input.inviteId } },
    {
      action: "invitation.revoke",
      run: () => revokeInvitation(input.tenantId, input.inviteId),
      detailsOf: ({ email }) => ({ email }),
    },
  );
}
