import { assert } from "@antelopejs/interface-api-util";
import type { Plan } from "../db";

const HTTP_BAD_REQUEST = 400;

/**
 * A contact-only plan is sold on quote: the workspace owner asks for it, an
 * operator assigns it. Every self-serve path that lets a customer pick a plan
 * refuses it.
 *
 * @param plan Plan the customer picked
 * @throws 400 when the plan is contact-only
 */
export function assertPlanIsSelfServe(plan: Plan): void {
  assert(
    !plan.isContactOnly,
    HTTP_BAD_REQUEST,
    "saas.errors.plan.contact_only",
  );
}
