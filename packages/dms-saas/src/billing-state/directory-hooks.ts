import { Logging } from "@antelopejs/interface-core/logging";
import { Hook, RegisterHook } from "@antelopejs/interface-dms/hooks";
import { recomputeTenantBillingState } from "./index";

const LOG_PREFIX = "[dms-saas:workspace-directory]";
// Removal hooks run before the membership or the invitation is deleted: the
// row is refreshed once the deletion that follows them has landed.
const AFTER_REMOVAL_DELAY_MS = 2000;

function refresh(tenantId: string): void {
  void recomputeTenantBillingState(tenantId).catch((error: unknown) => {
    Logging.Error(`${LOG_PREFIX} refresh of ${tenantId} failed`, error);
  });
}

function refreshAfterRemoval(tenantId: string): void {
  setTimeout(() => refresh(tenantId), AFTER_REMOVAL_DELAY_MS);
}

/**
 * Keeps the workspace directory's seats and owner current as members and
 * invitations come and go; billing changes refresh it with the billing state,
 * and the periodic recomputation catches anything else (an invitation that
 * expired, a plan whose price changed).
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
  RegisterHook(Hook.INVITE_DELETED, ({ tenantId }) => {
    refreshAfterRemoval(tenantId);
    return undefined;
  });
  RegisterHook(Hook.MEMBER_REMOVED, ({ tenantId }) => {
    refreshAfterRemoval(tenantId);
    return undefined;
  });
}
