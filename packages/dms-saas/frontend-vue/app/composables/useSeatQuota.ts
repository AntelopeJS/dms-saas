const SEAT_QUOTA_ENDPOINT = "/api/saas/tenant/seats";
const SEAT_QUOTA_STATE_KEY = "saas-seat-quota";

export interface SeatQuotaResponse {
  members: number;
  pendingInvites: number;
  occupied: number;
  /** `null` when no plan is in force, i.e. no seat ceiling to enforce. */
  maxMembers: number | null;
  isTenantOwner: boolean;
}

export function useSeatQuota(): SharedRequest<SeatQuotaResponse> {
  const { $authFetch } = useAuthFetch();
  return useSharedRequest(SEAT_QUOTA_STATE_KEY, () =>
    $authFetch<SeatQuotaResponse>(SEAT_QUOTA_ENDPOINT),
  );
}
