import type { PlanInterval } from "./usePlanIntervalLabel";

const TENANT_PLAN_ENDPOINT = "/api/saas/tenant/plan";
const TENANT_PLAN_STATE_KEY = "saas-tenant-plan";

export interface TenantPlanFeature {
  featureId: string;
  displayName: string;
  tooltip: string | null;
  unit: string | null;
  valueType: "boolean" | "number" | "string";
  isDetailRow: boolean;
  order: number;
}

export interface TenantPlanView {
  _id: string;
  name: string;
  price: number;
  currency: string;
  interval: PlanInterval;
  order: number;
  checkoutAvailable: boolean;
  featureValues: Record<string, unknown>;
}

export interface CurrentPlan {
  _id: string;
  name: string;
  description: string;
  price: number;
  currency: string;
  interval: PlanInterval;
}

export interface PendingPlanChange {
  planId: string;
  planName: string;
  effectiveAt: string | null;
}

export interface TenantPlanResponse {
  current: CurrentPlan | null;
  available: TenantPlanView[];
  features: TenantPlanFeature[];
  /** Consumer i18n prefixes feature labels resolve under, in lookup order. */
  featureTranslationPrefixes: string[];
  status: string | null;
  freeUntil: string | null;
  isComplimentary: boolean;
  isPlanChangeLocked: boolean;
  canRecoverComplimentary: boolean;
  paidUsageStartedAt: string | null;
  paidUsagePeriods: PaidUsagePeriod[] | null;
  currentPeriodEnd: string | null;
  pendingPlan: PendingPlanChange | null;
}

export interface PaidUsagePeriod {
  stripeSubscriptionId: string;
  start: string;
  end: string | null;
}

export interface ChangePlanResult {
  changed: boolean;
  scheduled: boolean;
  planId: string;
  effectiveAt: string | null;
  checkoutUrl: string | null;
}

/** The payload resolves inheritance for every public plan and carries the
 * features catalogue, so the plan card and the free-access banner share it. */
export function useTenantPlan() {
  const { $authFetch } = useAuthFetch();
  const shared = useSharedRequest(TENANT_PLAN_STATE_KEY, () =>
    $authFetch<TenantPlanResponse>(TENANT_PLAN_ENDPOINT),
  );

  function changePlan(planId: string): Promise<ChangePlanResult> {
    const returnUrl =
      typeof window !== "undefined" ? window.location.href : "/";
    return $authFetch<ChangePlanResult>(TENANT_PLAN_ENDPOINT, {
      method: "PUT",
      body: { planId, successUrl: returnUrl, cancelUrl: returnUrl },
    });
  }

  function cancelPendingChange(): Promise<ChangePlanResult> {
    return $authFetch<ChangePlanResult>(`${TENANT_PLAN_ENDPOINT}/pending`, {
      method: "DELETE",
    });
  }

  return { ...shared, changePlan, cancelPendingChange };
}
