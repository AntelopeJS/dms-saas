import { ImplementInterface } from "@antelopejs/interface-core";
import * as tenantLifecycleInterface from "@antelopejs/interface-dms-saas/tenant-lifecycle";
import {
  RegisterTenantLifecycleConsumer,
  type TenantLifecycleConsumer,
  type TenantLifecycleTransition,
} from "@antelopejs/interface-dms-saas/tenant-lifecycle";
import { beforeEach, type Mock, vi } from "vitest";
import * as tenantLifecycleImplementation from "../../src/implementations/dms-saas/tenant-lifecycle";

/**
 * Implements the workspace lifecycle interface with the module's own
 * implementation and registers a consumer of `transitions` with it, the way
 * another module does. The returned fake is its `consume`: it returns a
 * receipt for the delivered operation until a test gives it another behaviour,
 * and starts that way before each test. Call it at the top level of a test
 * file, after `useMongoDatabase`.
 *
 * @param name The consumer's registered name
 * @param transitions The transitions the consumer takes
 */
export function useLifecycleConsumer(
  name: string,
  transitions: TenantLifecycleTransition[],
): Mock<TenantLifecycleConsumer["consume"]> {
  ImplementInterface(tenantLifecycleInterface, tenantLifecycleImplementation);
  const consume = vi.fn<TenantLifecycleConsumer["consume"]>(
    async (message) => ({ receiptId: message.operationId }),
  );
  RegisterTenantLifecycleConsumer({ name, transitions, consume });
  beforeEach(() => {
    consume.mockReset();
  });
  return consume;
}
