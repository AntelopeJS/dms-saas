/**
 * Subscription statuses that close a workspace, mirroring the backend gate's
 * `BLOCKING_STATUSES`. The billing page stays reachable in those states, so its
 * blocks use this to keep the controls the gate still refuses out of the way.
 */
const BLOCKING_STATUSES = new Set(["pending_payment", "suspended", "cancelled"]);

export function isBlockingSubscriptionStatus(
  status: string | null | undefined,
): boolean {
  return !!status && BLOCKING_STATUSES.has(status);
}
