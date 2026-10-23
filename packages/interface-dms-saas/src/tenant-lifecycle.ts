import {
  InterfaceFunction,
  RegisteringProxy,
} from "@antelopejs/interface-core";

const CONSUMER_NAME_PATTERN = /^[a-z][a-z0-9._-]{2,63}$/;

/** Tenant lifecycle transitions delivered to required consumers. */
export const TENANT_LIFECYCLE_TRANSITIONS = [
  "created",
  "suspended",
  "reactivation_requested",
] as const;

/** Stable tenant lifecycle transition name. */
export type TenantLifecycleTransition =
  (typeof TENANT_LIFECYCLE_TRANSITIONS)[number];

/** Durable tenant lifecycle message delivered by dms-saas. */
export interface TenantLifecycleMessage {
  tenantId: string;
  operationId: string;
  transition: TenantLifecycleTransition;
  requestedAt: Date;
  /** Guarded downgrade provenance; never treat an unauthorized delivery as an ordinary resume. */
  planChangeOperationId?: string;
}

/** Durable acknowledgement returned by a required lifecycle consumer. */
export interface TenantLifecycleReceipt {
  receiptId: string;
  effectiveAt?: Date;
}

/** Required consumer for tenant lifecycle deliveries. */
export interface TenantLifecycleConsumer {
  name: string;
  /** Transitions the consumer is delivered; every consumer opts in explicitly. */
  transitions: readonly TenantLifecycleTransition[];
  consume(message: TenantLifecycleMessage): Promise<TenantLifecycleReceipt>;
}

/** Handle used to unregister a tenant lifecycle consumer. */
export interface TenantLifecycleConsumerRegistration {
  unregister(): void;
}

/**
 * Read the durable provisioning gate before provisioning resources from a tenant inventory.
 * Returns false for preparing, unpaid or cancelled self-service workspaces;
 * true for committed creations and legacy/bootstrap tenants without a marker.
 * This is not an existence, membership or access check. Storage errors propagate;
 * callers must fail closed, not interpret an unavailable check as eligibility.
 */
export const IsTenantProvisioningCommitted =
  InterfaceFunction<(tenantId: string) => Promise<boolean>>();

/** Internal registration proxy wired to the dms-saas lifecycle implementation. */
export namespace internal {
  export const RegisterTenantLifecycleConsumer = new RegisteringProxy<
    (name: string, consumer: TenantLifecycleConsumer) => void
  >();
}

/** Remove a tenant lifecycle consumer by name. */
export function UnregisterTenantLifecycleConsumer(name: string): void {
  internal.RegisterTenantLifecycleConsumer.unregister(name);
}

/**
 * Register a required tenant lifecycle consumer. Suspension closes SaaS
 * access before delivery; reactivation keeps access closed until every
 * registered consumer has returned a durable receipt.
 * Opt into `created` for post-provisioning delivery, after ownership, billing
 * records and pre-provisioning hooks succeed and the first invoice is paid
 * (or no payment is required). Delivery is at least once: deduplicate by
 * operationId and durably link resources before returning a receipt.
 */
export function RegisterTenantLifecycleConsumer(
  consumer: TenantLifecycleConsumer,
): TenantLifecycleConsumerRegistration {
  if (!CONSUMER_NAME_PATTERN.test(consumer.name)) {
    throw new Error("Invalid workspace lifecycle consumer name");
  }
  internal.RegisterTenantLifecycleConsumer.register(consumer.name, consumer);
  return {
    unregister: () => UnregisterTenantLifecycleConsumer(consumer.name),
  };
}
