import type { TenantPlanResponse } from "./useTenantPlan";

type ComplimentaryAccessState = Pick<
  TenantPlanResponse,
  "isPlanChangeLocked" | "freeUntil"
>;

/** A complimentary gift still in force, with its end date when it has one. */
export interface ComplimentaryAccess {
  endsAt: string | null;
}

/**
 * `isPlanChangeLocked` is the server applying `isComplimentaryPlanLocked`:
 * reading it instead of comparing `freeUntil` to the browser clock keeps the
 * billing page aligned with what the plan endpoints actually allow.
 */
export function resolveComplimentaryAccess(
  plan: ComplimentaryAccessState | null,
): ComplimentaryAccess | null {
  if (!plan?.isPlanChangeLocked) return null;
  return { endsAt: plan.freeUntil };
}
