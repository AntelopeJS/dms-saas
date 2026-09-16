import {
  InterfaceFunction,
  RegisteringProxy,
} from "@antelopejs/interface-core";

const CONSUMER_NAME_PATTERN = /^[a-z][a-z0-9._-]{2,63}$/;

/** Workspace lifecycle transitions delivered to required consumers. */
export const WORKSPACE_LIFECYCLE_TRANSITIONS = [
  "created",
  "suspended",
  "reactivation_requested",
] as const;

/** Stable workspace lifecycle transition name. */
export type WorkspaceLifecycleTransition =
  (typeof WORKSPACE_LIFECYCLE_TRANSITIONS)[number];

/** Durable tenant lifecycle message delivered by dms-saas. */
export interface WorkspaceLifecycleMessage {
  tenantId: string;
  operationId: string;
  transition: WorkspaceLifecycleTransition;
  requestedAt: Date;
}

/** Durable acknowledgement returned by a required lifecycle consumer. */
export interface WorkspaceLifecycleReceipt {
  receiptId: string;
  effectiveAt?: Date;
}

/** Required consumer for workspace lifecycle deliveries. */
export interface WorkspaceLifecycleConsumer {
  name: string;
  /** Transitions the consumer is delivered; every consumer opts in explicitly. */
  transitions: readonly WorkspaceLifecycleTransition[];
  consume(
    message: WorkspaceLifecycleMessage,
  ): Promise<WorkspaceLifecycleReceipt>;
}

/** Handle used to unregister a workspace lifecycle consumer. */
export interface WorkspaceLifecycleConsumerRegistration {
  unregister(): void;
}

/**
 * Read the durable provisioning gate before provisioning resources from a tenant inventory.
 * Returns false for preparing, unpaid or cancelled self-service workspaces;
 * true for committed creations and legacy/bootstrap tenants without a marker.
 * This is not an existence, membership or access check. Storage errors propagate;
 * callers must fail closed, not interpret an unavailable check as eligibility.
 */
export const IsWorkspaceProvisioningCommitted =
  InterfaceFunction<(tenantId: string) => Promise<boolean>>();

/** Internal registration proxy wired to the dms-saas lifecycle implementation. */
export namespace internal {
  export const RegisterWorkspaceLifecycleConsumer = new RegisteringProxy<
    (name: string, consumer: WorkspaceLifecycleConsumer) => void
  >();
}

/** Remove a workspace lifecycle consumer by name. */
export function UnregisterWorkspaceLifecycleConsumer(name: string): void {
  internal.RegisterWorkspaceLifecycleConsumer.unregister(name);
}

/**
 * Register a required workspace lifecycle consumer. Suspension closes SaaS
 * access before delivery; reactivation keeps access closed until every
 * registered consumer has returned a durable receipt.
 * Opt into `created` for post-provisioning delivery, after ownership, billing
 * records and pre-provisioning hooks succeed and the first invoice is paid
 * (or no payment is required). Delivery is at least once: deduplicate by
 * operationId and durably link resources before returning a receipt.
 */
export function RegisterWorkspaceLifecycleConsumer(
  consumer: WorkspaceLifecycleConsumer,
): WorkspaceLifecycleConsumerRegistration {
  if (!CONSUMER_NAME_PATTERN.test(consumer.name)) {
    throw new Error("Invalid workspace lifecycle consumer name");
  }
  internal.RegisterWorkspaceLifecycleConsumer.register(consumer.name, consumer);
  return {
    unregister: () => UnregisterWorkspaceLifecycleConsumer(consumer.name),
  };
}
