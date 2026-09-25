import type { WorkspaceAccess } from "./useWorkspaceAccessCache";

const PAST_DUE_STATUS = "past_due";

/**
 * Whether the workspace-wide past-due banner shows. Only `past_due` does: a
 * suspended workspace is already routed to its own screen, and every other
 * status has nothing to settle.
 *
 * @param access Current workspace access, null until it is known
 */
export function isPastDueBannerVisible(
  access: WorkspaceAccess | null,
): boolean {
  return access?.status === PAST_DUE_STATUS;
}

let bannerHostOwner: symbol | null = null;

/**
 * Lets exactly one mounted banner host own the teleport target, so a second
 * mount (a sidebar re-render, the mobile drawer) never shows the banner twice.
 *
 * @returns Whether the caller now owns the host
 */
export function claimPastDueBannerHost(owner: symbol): boolean {
  if (bannerHostOwner && bannerHostOwner !== owner) return false;
  bannerHostOwner = owner;
  return true;
}

export function releasePastDueBannerHost(owner: symbol): void {
  if (bannerHostOwner === owner) bannerHostOwner = null;
}
