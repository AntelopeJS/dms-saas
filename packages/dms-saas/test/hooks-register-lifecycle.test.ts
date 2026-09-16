import { beforeEach, describe, expect, it, vi } from "vitest";

interface Deferred {
  promise: Promise<void>;
  resolve: () => void;
  reject: (reason: unknown) => void;
}

type HookListener = () => Promise<unknown>;

const hookDoubles = vi.hoisted(() => ({
  databaseInitialized: "database-initialized",
  registerHook: vi.fn(),
  registerTenantDataExportContributor: vi.fn(),
  ensureLegalDocumentsSingleton: vi.fn<() => Promise<void>>(),
  resumePendingPlanMigrations: vi.fn<() => Promise<void>>(),
  recomputeAllTenantBillingStates: vi.fn<() => Promise<void>>(),
  reconcileWorkspaceLifecycleDeliveries: vi.fn<() => Promise<void>>(),
}));

vi.mock("@antelopejs/interface-database-decorators", () => ({
  GetModel: vi.fn(),
}));

vi.mock("@antelopejs/interface-dms/hooks", () => ({
  Hook: {
    TENANT_DELETED: "tenant-deleted",
    DATABASE_INITIALIZED: hookDoubles.databaseInitialized,
  },
  RegisterHook: hookDoubles.registerHook,
  RegisterTenantDataExportContributor:
    hookDoubles.registerTenantDataExportContributor,
}));

vi.mock("../src/automation", () => ({ emitAutomationEvent: vi.fn() }));
vi.mock("../src/billing-state", () => ({
  recomputeAllTenantBillingStates: hookDoubles.recomputeAllTenantBillingStates,
}));
vi.mock("../src/db", () => ({ TenantBillingStateModel: class {} }));
vi.mock("../src/operator-actions", () => ({
  reconcileWorkspaceLifecycleDeliveries:
    hookDoubles.reconcileWorkspaceLifecycleDeliveries,
}));
vi.mock("../src/pages/module", () => ({ SAAS_MODULE_ID: "dms-saas" }));
vi.mock("../src/routes", () => ({
  ensureLegalDocumentsSingleton: hookDoubles.ensureLegalDocumentsSingleton,
}));
vi.mock("../src/workers", () => ({
  resumePendingPlanMigrations: hookDoubles.resumePendingPlanMigrations,
}));
vi.mock("../src/hooks/tenant-export", () => ({
  exportSaasTenantData: vi.fn(),
}));

import { registerSaasHookListeners } from "../src/hooks/register";

function createDeferred(): Deferred {
  let resolve = () => undefined;
  let reject = (_reason: unknown) => undefined;
  const promise = new Promise<void>((settle, fail) => {
    resolve = settle;
    reject = fail;
  });
  return { promise, resolve, reject };
}

async function flushPromiseQueue(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

function getDatabaseInitializedListener(): HookListener {
  const registration = hookDoubles.registerHook.mock.calls.find(
    ([hook]) => hook === hookDoubles.databaseInitialized,
  );
  if (!registration)
    throw new Error("database initialized hook not registered");
  return registration[1] as HookListener;
}

beforeEach(() => {
  vi.clearAllMocks();
  hookDoubles.ensureLegalDocumentsSingleton.mockResolvedValue(undefined);
  hookDoubles.resumePendingPlanMigrations.mockResolvedValue(undefined);
  hookDoubles.recomputeAllTenantBillingStates.mockResolvedValue(undefined);
  hookDoubles.reconcileWorkspaceLifecycleDeliveries.mockResolvedValue(
    undefined,
  );
  registerSaasHookListeners();
});

describe("database initialized hook", () => {
  it("stays pending until migration recovery and billing recomputation finish", async () => {
    const migrations = createDeferred();
    const billing = createDeferred();
    hookDoubles.resumePendingPlanMigrations.mockReturnValue(migrations.promise);
    hookDoubles.recomputeAllTenantBillingStates.mockReturnValue(
      billing.promise,
    );
    const listener = getDatabaseInitializedListener();

    let isSettled = false;
    const completion = listener().finally(() => {
      isSettled = true;
    });

    await vi.waitFor(() => {
      expect(hookDoubles.resumePendingPlanMigrations).toHaveBeenCalledOnce();
      expect(
        hookDoubles.recomputeAllTenantBillingStates,
      ).toHaveBeenCalledOnce();
      expect(
        hookDoubles.reconcileWorkspaceLifecycleDeliveries,
      ).toHaveBeenCalledOnce();
    });
    expect(isSettled).toBe(false);

    migrations.resolve();
    await Promise.resolve();
    expect(isSettled).toBe(false);

    billing.resolve();
    await completion;
    expect(isSettled).toBe(true);
  });

  it("waits for sibling work before reporting a single failure", async () => {
    const migrations = createDeferred();
    const billing = createDeferred();
    const failure = new Error("migration recovery failed");
    hookDoubles.resumePendingPlanMigrations.mockReturnValue(migrations.promise);
    hookDoubles.recomputeAllTenantBillingStates.mockReturnValue(
      billing.promise,
    );
    const listener = getDatabaseInitializedListener();

    let isSettled = false;
    let reportedFailure: unknown;
    const completion = listener().then(
      () => {
        isSettled = true;
      },
      (reason: unknown) => {
        isSettled = true;
        reportedFailure = reason;
      },
    );

    await vi.waitFor(() => {
      expect(hookDoubles.resumePendingPlanMigrations).toHaveBeenCalledOnce();
      expect(
        hookDoubles.recomputeAllTenantBillingStates,
      ).toHaveBeenCalledOnce();
    });
    migrations.reject(failure);
    await flushPromiseQueue();
    expect(isSettled).toBe(false);

    billing.resolve();
    await completion;
    expect(reportedFailure).toBe(failure);
  });

  it("aggregates failures after both operations settle", async () => {
    const migrationFailure = new Error("migration recovery failed");
    const billingFailure = new Error("billing recomputation failed");
    hookDoubles.resumePendingPlanMigrations.mockRejectedValue(migrationFailure);
    hookDoubles.recomputeAllTenantBillingStates.mockRejectedValue(
      billingFailure,
    );
    const listener = getDatabaseInitializedListener();

    const failure = await listener().catch((reason: unknown) => reason);

    expect(failure).toBeInstanceOf(AggregateError);
    if (!(failure instanceof AggregateError)) return;
    expect(failure.errors).toEqual([migrationFailure, billingFailure]);
  });
});
