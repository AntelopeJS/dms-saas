import type { Plan } from "../db";

const FREE_PLAN_PRICE = 0;

export function isFreePlan(plan: Plan): boolean {
  return plan.price <= FREE_PLAN_PRICE;
}
