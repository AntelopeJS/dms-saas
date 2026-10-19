import type { Plan, PlanAudience } from "../db";

/** The audience of a plan sold to every customer type. */
export const ANY_PLAN_AUDIENCE: PlanAudience = "any";

/**
 * Whether a plan is sold to a customer type: its own, or any type.
 *
 * @param plan The plan
 * @param customerType The workspace's customer type, when it has one
 */
export function isPlanOfferedTo(
  plan: Pick<Plan, "audience">,
  customerType: string | null | undefined,
): boolean {
  return plan.audience === ANY_PLAN_AUDIENCE || plan.audience === customerType;
}

/**
 * Whether an operator may put a workspace on a plan. A workspace without a
 * customer type was never matched to an audience, so every plan is open to
 * it; one with a type takes the plans sold to that type.
 *
 * @param plan The plan
 * @param customerType The workspace's customer type, when it has one
 */
export function isPlanOpenToWorkspace(
  plan: Pick<Plan, "audience">,
  customerType: string | null | undefined,
): boolean {
  return !customerType || isPlanOfferedTo(plan, customerType);
}
