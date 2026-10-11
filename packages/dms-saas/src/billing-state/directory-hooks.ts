import { Logging } from "@antelopejs/interface-core/logging";
import {
  Hook,
  type InviteDeletedReason,
  RegisterHook,
} from "@antelopejs/interface-dms/hooks";
import type { DirectoryDepartures } from "./directory";
import { recomputeTenantBillingState } from "./index";

const LOG_PREFIX = "[dms-saas:workspace-directory]";
// A replaced or resent invitation hands its seat to its successor, already
// stored by the time the old one is deleted.
const SEAT_HANDED_OVER: ReadonlySet<InviteDeletedReason> = new Set([
  "replaced",
  "resent",
]);

function refresh(tenantId: string, departures: DirectoryDepartures = {}): void {
  void recomputeTenantBillingState(tenantId, departures).catch(
    (error: unknown) => {
      Logging.Error(`${LOG_PREFIX} refresh of ${tenantId} failed`, error);
    },
  );
}

/**
 * Keeps the workspace directory's seats and owner current as members and
 * invitations come and go; billing changes refresh it with the billing state,
 * and the periodic recomputation catches anything else (an invitation that
 * expired, a plan whose price changed). The removal hooks run before the DMS
 * deletes the rows, so the departing members or invitee are left out.
 */
export function registerWorkspaceDirectoryHooks(): void {
  RegisterHook(Hook.MEMBER_ADDED, ({ tenantId }) => {
    refresh(tenantId);
    return undefined;
  });
  RegisterHook(Hook.INVITE_CREATED, ({ tenantId }) => {
    refresh(tenantId);
    return undefined;
  });
  RegisterHook(Hook.INVITE_DELETED, ({ tenantId, email, reason }) => {
    refresh(
      tenantId,
      SEAT_HANDED_OVER.has(reason) ? {} : { inviteeEmail: email },
    );
    return undefined;
  });
  RegisterHook(Hook.MEMBER_REMOVED, ({ tenantId, userIds }) => {
    refresh(tenantId, { userIds });
    return undefined;
  });
}
