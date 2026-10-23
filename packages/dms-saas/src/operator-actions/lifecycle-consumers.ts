import { Logging } from "@antelopejs/interface-core/logging";
import type { TenantLifecycleConsumer } from "@antelopejs/interface-dms-saas/tenant-lifecycle";

const LOG_PREFIX = "[dms-saas:workspace-lifecycle]";
const consumers = new Map<string, TenantLifecycleConsumer>();

// RegisteringProxy changes ownership before calling the implementation. A
// rejected collision would leave automatic unload cleanup attached to the
// rejected consumer instead of the active one, so the latest owner must win.
function register(name: string, consumer: TenantLifecycleConsumer): void {
  if (consumers.has(name)) {
    Logging.Error(
      `${LOG_PREFIX} consumer name '${name}' is already taken: the previous consumer is replaced`,
    );
  }
  consumers.set(name, consumer);
}

function unregister(name: string): void {
  consumers.delete(name);
}

export namespace internal {
  export const RegisterTenantLifecycleConsumer = { register, unregister };
}

/** Returns registered consumers in deterministic delivery order. */
export function getWorkspaceLifecycleConsumers(): TenantLifecycleConsumer[] {
  return [...consumers.values()].sort((left, right) =>
    left.name.localeCompare(right.name),
  );
}

/** Resolves the active registration for a persisted delivery. */
export function getWorkspaceLifecycleConsumer(
  name: string,
): TenantLifecycleConsumer | undefined {
  return consumers.get(name);
}
