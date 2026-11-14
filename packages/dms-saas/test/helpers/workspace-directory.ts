import type { WorkspaceDirectoryFields } from "@antelopejs/interface-dms-saas/db/tables/tenantBillingState.table";

/** The directory row of a workspace that bills nothing and has no owner. */
export const EMPTY_DIRECTORY: WorkspaceDirectoryFields = {
  planId: null,
  planName: null,
  planInterval: null,
  planBillingMode: null,
  planUnitAmountMinor: null,
  currency: null,
  seats: 0,
  members: 0,
  pendingPlanId: null,
  isComplimentary: false,
  mrrMinor: 0,
  previousMrrMinor: 0,
  reportingMrr: 0,
  renewalKind: null,
  renewsAt: null,
  stateSince: null,
  ownerStatus: "none",
  ownerNeverJoined: false,
  ownerName: null,
  ownerEmail: null,
};
