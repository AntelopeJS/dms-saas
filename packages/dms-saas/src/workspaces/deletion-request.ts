import type { TenantSubscription } from "../db";

/**
 * What a resumed workspace no longer carries of its owner's deletion: once
 * it is back, a later cancellation is no deletion of theirs.
 */
export const DELETION_REQUEST_CLEARED: Pick<
  TenantSubscription,
  "deletionRequestedAt" | "deletionRequestedBy"
> = { deletionRequestedAt: null, deletionRequestedBy: null };
