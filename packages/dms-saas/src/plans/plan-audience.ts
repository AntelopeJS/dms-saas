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
