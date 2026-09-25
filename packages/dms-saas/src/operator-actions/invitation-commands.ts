import { randomUUID } from "node:crypto";
import {
  type InvitationLink,
  type ReissuedInvitation,
  resendInvitation,
  resolveInvitationLink,
} from "../workspaces/invitations";
import { executeOperatorAction, type OperatorActor } from "./journal";
import type { OperatorActionDetails, WorkspaceOperatorAction } from "./types";

export interface InvitationCommandInput {
  tenantId: string;
  inviteId: string;
  actor: OperatorActor;
}

interface JournaledEffect<T> {
  action: WorkspaceOperatorAction;
  run: () => Promise<T>;
  detailsOf: (value: T) => OperatorActionDetails;
}

/** Runs a one-shot effect through the operator journal and hands its value back. */
async function runJournaled<T>(
  input: InvitationCommandInput,
  effect: JournaledEffect<T>,
): Promise<T> {
  const outcomes: T[] = [];
  await executeOperatorAction(
    {
      operationId: randomUUID(),
      tenantId: input.tenantId,
      actor: input.actor,
      action: effect.action,
      details: { inviteId: input.inviteId },
    },
    async (running) => {
      const value = await effect.run();
      outcomes.push(value);
      return {
        details: { ...running.details, ...effect.detailsOf(value) },
        effectiveAt: new Date(),
      };
    },
  );
  const [outcome] = outcomes;
  if (outcome === undefined) throw new Error("Journaled effect did not run");
  return outcome;
}

/**
 * Reissues a pending invitation and emails it, journaled like every operator
 * action so the back office keeps a trace of who re-sent what.
 */
export async function resendInvitationCommand(
  input: InvitationCommandInput,
): Promise<ReissuedInvitation> {
  return runJournaled(input, {
    action: "invitation.resend",
    run: () => resendInvitation(input.tenantId, input.inviteId),
    detailsOf: ({ invite, emailDelivery }) => ({
      email: invite.email,
      emailDelivery,
    }),
  });
}

/**
 * Hands the invitation's signup link to an operator. The link is a bearer
 * credential for the workspace, so every disclosure is journaled — without the
 * token itself.
 */
export async function copyInvitationLinkCommand(
  input: InvitationCommandInput,
): Promise<InvitationLink> {
  return runJournaled(input, {
    action: "invitation.link_copy",
    run: () => resolveInvitationLink(input.tenantId, input.inviteId),
    detailsOf: ({ expiresAt }) => ({ expiresAt: expiresAt.toISOString() }),
  });
}
