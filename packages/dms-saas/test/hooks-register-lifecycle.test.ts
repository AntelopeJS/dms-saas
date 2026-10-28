import { GetModel } from "@antelopejs/interface-database-decorators";
import { DEFAULT_TENANT_ID } from "@antelopejs/interface-dms/constants";
import { tenantsTableName } from "@antelopejs/interface-dms/db";
import { ExecuteHooks, Hook } from "@antelopejs/interface-dms/hooks";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  legalDocumentsTableName,
  PlanModel,
  planMigrationsTableName,
  plansTableName,
  TenantSubscriptionModel,
} from "../src/db";
import { registerSaasHookListeners } from "../src/hooks/register";
import { lifecycleDeliveriesTableName } from "../src/operator-actions/db/lifecycle-delivery.table";
import { useMongoDatabase } from "./helpers/mongo";
import { useQueryGate } from "./helpers/query-gate";
import { useSuiteStripe } from "./helpers/stripe";
import { PLAN } from "./helpers/registration";

useMongoDatabase("hooks-register-lifecycle");
useSuiteStripe();
const gate = useQueryGate();

beforeAll(registerSaasHookListeners);

describe("tenant provisioning hook", () => {
  beforeEach(async () => {
    await GetModel(PlanModel).table.delete().run();
    await GetModel(PlanModel).insert(PLAN);
  });

  async function provision(tenantId: string): Promise<void> {
    await ExecuteHooks(Hook.TENANT_BEING_PROVISIONED, { tenantId, extras: {} });
  }

  it("gives the DMS default tenant the default plan at its creation", async () => {
    await provision(DEFAULT_TENANT_ID);

    expect(
      await GetModel(TenantSubscriptionModel, DEFAULT_TENANT_ID).getAll(),
    ).toEqual([
      expect.objectContaining({ _id: DEFAULT_TENANT_ID, planId: PLAN._id }),
    ]);
  });

  it("leaves a workspace the signup flow provisions to that flow", async () => {
    await provision("acme");

    expect(await GetModel(TenantSubscriptionModel, "acme").getAll()).toEqual(
      [],
    );
  });
});

describe("database initialized hook", () => {
  it("stays pending until migration recovery and billing recomputation finish", async () => {
    const migrations = gate.hold(planMigrationsTableName);
    const billing = gate.hold(tenantsTableName);

    let isSettled = false;
    const completion = ExecuteHooks(Hook.DATABASE_INITIALIZED).finally(() => {
      isSettled = true;
    });

    await vi.waitFor(() => {
      expect(gate.reads(planMigrationsTableName)).toBe(1);
      expect(gate.reads(tenantsTableName)).toBe(1);
      expect(gate.reads(lifecycleDeliveriesTableName)).toBe(1);
    });
    expect(isSettled).toBe(false);

    migrations.release();
    await Promise.resolve();
    expect(isSettled).toBe(false);

    billing.release();
    await completion;
    expect(isSettled).toBe(true);
  });

  it("waits for sibling work before reporting a single failure", async () => {
    const migrations = gate.hold(planMigrationsTableName);
    const billing = gate.hold(tenantsTableName);
    const failure = new Error("migration recovery failed");

    let isSettled = false;
    const completion = ExecuteHooks(Hook.DATABASE_INITIALIZED).then(
      () => {
        isSettled = true;
      },
      (reason: Error) => {
        isSettled = true;
        return reason;
      },
    );

    await vi.waitFor(() => {
      expect(gate.reads(planMigrationsTableName)).toBe(1);
      expect(gate.reads(tenantsTableName)).toBe(1);
    });
    migrations.fail(failure);
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(isSettled).toBe(false);

    billing.release();
    expect(await completion).toBe(failure);
  });

  it("aggregates failures after both operations settle", async () => {
    const migrationFailure = new Error("migration recovery failed");
    const billingFailure = new Error("billing recomputation failed");
    gate.hold(planMigrationsTableName).fail(migrationFailure);
    gate.hold(tenantsTableName).fail(billingFailure);

    const failure = await ExecuteHooks(Hook.DATABASE_INITIALIZED).catch(
      (reason: Error) => reason,
    );

    expect(failure).toBeInstanceOf(AggregateError);
    expect(failure).toMatchObject({
      errors: [migrationFailure, billingFailure],
    });
  });
});

describe("Stripe plan reconciliation at boot", () => {
  it("waits for the database initialized signal", async () => {
    expect(gate.reads(plansTableName)).toBe(0);

    await ExecuteHooks(Hook.DATABASE_INITIALIZED);

    expect(gate.reads(plansTableName)).toBe(1);
  });

  it("still starts when the rest of the database initialization fails", async () => {
    gate
      .hold(legalDocumentsTableName)
      .fail(new Error("legal documents unavailable"));

    await expect(ExecuteHooks(Hook.DATABASE_INITIALIZED)).rejects.toThrow(
      "legal documents unavailable",
    );
    expect(gate.reads(plansTableName)).toBe(1);
  });
});
