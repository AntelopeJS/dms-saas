import {
  InterfaceFunction,
  RegisteringProxy,
} from "@antelopejs/interface-core";
import type { Plan } from "./db/tables/plans.table";

/** An inventory constraint that prevents a plan change. */
export interface PlanChangeIncompatibility {
  code: string;
  message: string;
  resource?: string;
}

/** Validation is read-only; effective validation runs before granting Free. */
export interface PlanChangeValidationRequest {
  tenantId: string;
  currentPlan: Plan | null;
  targetPlan: Plan;
  operationId: string;
  phase: "preview" | "schedule" | "effective";
  effectiveAt: Date | null;
}

/**
 * The application validates its inventory after inventory admission is closed
 * and earlier writers have drained. This callback must not mutate inventory
 * or call Stripe. Admission tracking and atomic quota reservations belong to
 * the inventory writers, not to a lock held by this callback.
 * Registration opts deferred changes into the guarded paid-to-Free flow;
 * guarded paid-to-paid changes are deliberately unsupported.
 */
export interface PlanChangePolicy {
  name: string;
  validatePlanChange(
    request: PlanChangeValidationRequest,
  ): Promise<PlanChangeIncompatibility[]>;
}

/** Current billing plan and additional future inventory restrictions. */
export interface TenantPlanConstraints {
  currentPlan: Plan | null;
  pendingPlan: Plan | null;
  effectiveAt: Date | null;
  /** Owner of a downgrade-specific execution hold, including before webhook delivery. */
  planChangeOperationId: string | null;
  /** Execution entitlement is closed; remediation is still allowed. */
  blocked: boolean;
  /** A short preparation requires compatibility-affecting admissions to wait. */
  admissionBlocked: boolean;
  incompatibilities: PlanChangeIncompatibility[];
}

/** Read-only snapshot; writers must enter inventory admission before reading it. */
export const GetTenantPlanConstraints =
  InterfaceFunction<(tenantId: string) => Promise<TenantPlanConstraints>>();

/**
 * Read current occupied seats, including unexpired invitations and excluding
 * platform support. This is not a billing cache or an atomic quota reservation.
 * No admission or mutation is performed; callers needing a stable inventory
 * must coordinate its writers before reading.
 */
export const CountOccupiedSeats =
  InterfaceFunction<(tenantId: string) => Promise<number>>();

/** Provenance of the only downgrade hold an activation consumer may release. */
export interface PlanChangeActivation {
  planChangeOperationId: string;
  operationId: string;
  gateId: string;
}

/**
 * Read the current activation authorization without opening user access.
 * Consumers must match both operation IDs on the durable lifecycle message,
 * evaluate every DMS access gate, and preserve all other denials and holds.
 * A null result or error never authorizes a guarded lifecycle delivery.
 * This snapshot is not a reservation; re-read under the consumer's sleep lock.
 */
export const GetPlanChangeActivation =
  InterfaceFunction<
    (tenantId: string) => Promise<PlanChangeActivation | null>
  >();

/** Internal module registration proxy. */
export namespace internal {
  export const RegisterPlanChangePolicy = new RegisteringProxy<
    (name: string, policy: PlanChangePolicy) => void
  >();
}

/** Register the sole inventory policy; missing or competing policies fail closed. */
export function RegisterPlanChangePolicy(policy: PlanChangePolicy): void {
  if (!policy.name.trim())
    throw new Error("Plan change policy name is required");
  internal.RegisterPlanChangePolicy.register(policy.name, policy);
}

/** Unloading a policy does not remove restrictions on persisted changes. */
export function UnregisterPlanChangePolicy(name: string): void {
  internal.RegisterPlanChangePolicy.unregister(name);
}
