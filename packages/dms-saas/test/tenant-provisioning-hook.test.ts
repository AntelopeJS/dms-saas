import { GetModel } from "@antelopejs/interface-database-decorators";
import type { TenantLifecycleMessage } from "@antelopejs/interface-dms-saas/tenant-lifecycle";
import { UserModel } from "@antelopejs/interface-dms/auth/db";
import { TenantModel } from "@antelopejs/interface-dms/db";
import {
  Hook,
  RegisterHook,
  UnregisterHook,
  type TenantDeletionContext,
} from "@antelopejs/interface-dms/hooks";
import { runTenantLifecycleOperation } from "@antelopejs/interface-dms/tenant-lifecycle";
import { fromPartial } from "@total-typescript/shoehorn";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  emitTenantBeingProvisioned,
  type TenantBeingProvisionedPayload,
} from "../src/hooks/tenant-provisioning";
import { internal as lifecycle } from "../src/implementations/dms-saas/tenant-lifecycle";
import { reconcileWorkspaceLifecycleDeliveries } from "../src/operator-actions/lifecycle-outbox";
import { getStripeClient } from "../src/stripe/client";
import { getWorkspaceDeletionOperationId } from "../src/workspaces/deletion";
import {
  buildController,
  buildRegisterBody,
  listen,
  PLAN,
  useRegistrationWorld,
  world,
} from "./helpers/registration";
import { useMongoDatabase } from "./helpers/mongo";
import { useSuiteStripe } from "./helpers/stripe";

useMongoDatabase("tenant-provisioning-hook");
useSuiteStripe();

/**
 * The registration flow driven end to end against the suite's database and a
 * Stripe that keeps what it is asked to: these tests are what stands in for a
 * first consumer, so they assert the state the world is left in — who exists,
 * what still bills — rather than which function was called.
 */
const stripe = useRegistrationWorld();

async function allDeliveriesSucceeded(): Promise<boolean> {
  return (await world.deliveries()).every((row) => row.status === "succeeded");
}

afterEach(() => {
  lifecycle.RegisterTenantLifecycleConsumer.unregister("test.created");
});

describe("tenant-being-provisioned hook", () => {
  it("delivers created only with committed ownership, records, hooks and payment", async () => {
    let hookFinished = false;
    listen(async () => {
      hookFinished = true;
      expect(await world.deliveries()).toEqual([
        expect.objectContaining({ provisioningState: "preparing" }),
      ]);
    });
    const consume = vi.fn(async (message: TenantLifecycleMessage) => {
      expect(hookFinished).toBe(true);
      const [owner] = await world.owners(message.tenantId);
      expect((await world.users()).map((user) => user._id)).toContain(
        owner?.userId,
      );
      expect(await world.tenantRecords(message.tenantId)).toHaveLength(2);
      expect(stripe.paidInvoices.size).toBe(1);
      return { receiptId: message.operationId };
    });
    lifecycle.RegisterTenantLifecycleConsumer.register("test.created", {
      name: "test.created",
      transitions: ["created"],
      consume,
    });
    await buildController().register(buildRegisterBody());
    expect(consume).toHaveBeenCalledOnce();
    expect(await allDeliveriesSucceeded()).toBe(true);
  });

  it("supports already-paid zero-total invoices without paying again", async () => {
    vi.spyOn(getStripeClient().invoices, "retrieve").mockResolvedValue(
      fromPartial({ status: "paid" }),
    );
    const pay = vi.spyOn(getStripeClient().invoices, "pay");
    const result = await buildController().register(buildRegisterBody());
    await expect(
      GetModel(TenantModel).get(result.tenantId),
    ).resolves.toBeDefined();
    expect(pay).not.toHaveBeenCalled();
    expect(await allDeliveriesSucceeded()).toBe(true);
  });

  it("commits trials without paying an invoice", async () => {
    await world.updatePlan(PLAN._id, { trialDays: 14 });
    const pay = vi.spyOn(getStripeClient().invoices, "pay");
    await buildController().register(buildRegisterBody());
    expect(pay).not.toHaveBeenCalled();
    expect(await world.deliveries()).toEqual([
      expect.objectContaining({
        transition: "created",
        status: "succeeded",
        provisioningInvoiceId: null,
      }),
    ]);
  });

  it("tombstones the creation intent before rolling back a definitive card decline", async () => {
    vi.spyOn(getStripeClient().invoices, "pay").mockRejectedValue(
      Object.assign(new Error("declined"), { type: "StripeCardError" }),
    );
    await expect(
      buildController().register(buildRegisterBody()),
    ).rejects.toThrow("declined");
    expect(await world.deliveries()).toEqual([
      expect.objectContaining({ provisioningState: "cancelled" }),
    ]);
    expect(await world.tenants()).toEqual([]);
    expect(await world.users()).toEqual([]);
  });

  it("preserves membership and replays a charge whose successful response was lost", async () => {
    vi.spyOn(getStripeClient().invoices, "pay").mockImplementation(
      async (id) => {
        stripe.paidInvoices.add(id);
        throw new Error("connection lost");
      },
    );
    await expect(
      buildController().register(buildRegisterBody()),
    ).rejects.toThrow("connection lost");
    expect(await world.users()).toHaveLength(1);
    expect(await world.tenants()).toHaveLength(1);
    expect(await world.owners()).toHaveLength(1);
    await reconcileWorkspaceLifecycleDeliveries();
    expect(await allDeliveriesSucceeded()).toBe(true);
  });

  it("hands a listener the workspace and the consumer's own capture", async () => {
    const seen: TenantBeingProvisionedPayload[] = [];
    listen((payload) => {
      seen.push(payload);
    });

    const result = await buildController().register(
      buildRegisterBody({ extras: { referral: "podcast", seats: 3 } }),
    );

    expect(seen).toHaveLength(1);
    expect(seen[0]).toEqual({
      tenantId: result.tenantId,
      userId: result.userId,
      extras: { referral: "podcast", seats: 3 },
    });
    const attempts = await world.attempts();
    expect(attempts[0]).not.toHaveProperty("extras");
    expect(JSON.stringify(attempts)).not.toContain("podcast");
  });

  it("runs while the workspace is already there to be written against", async () => {
    const workspaceAtHookTime: Partial<Record<"tenant" | "user", string>> = {};
    listen(async (payload) => {
      const [tenant, user] = await Promise.all([
        GetModel(TenantModel).get(payload.tenantId),
        GetModel(UserModel).get(payload.userId ?? ""),
      ]);
      workspaceAtHookTime.tenant = tenant?.name;
      workspaceAtHookTime.user = user?.email;
    });

    await buildController().register(buildRegisterBody());

    expect(workspaceAtHookTime.tenant).toBe("Acme Studio");
    expect(workspaceAtHookTime.user).toContain("@example.com");
  });

  it("hands an empty capture, not a missing one, when the consumer captured nothing", async () => {
    const seen: TenantBeingProvisionedPayload[] = [];
    listen((payload) => {
      seen.push(payload);
    });

    await buildController().register(buildRegisterBody());

    expect(seen[0]?.extras).toEqual({});
  });

  it("retains provider and account evidence when a customer creation response is lost", async () => {
    vi.spyOn(getStripeClient().customers, "create").mockImplementationOnce(
      async () => {
        stripe.customers.add("unknown-customer");
        throw new Error("customer acknowledgement lost");
      },
    );
    await expect(
      buildController().register(buildRegisterBody()),
    ).rejects.toThrow("customer acknowledgement lost");
    expect(await world.users()).toHaveLength(1);
    expect(stripe.customers.has("unknown-customer")).toBe(true);
    expect(await world.attempts()).toEqual([
      expect.objectContaining({
        state: "reconciliation_required",
        stripeCustomerId: null,
      }),
    ]);
  });

  it("does not destructively roll back while tenant closure is incomplete", async () => {
    listen(async ({ tenantId }) => {
      await runTenantLifecycleOperation(tenantId, async () => {
        throw new Error("producer still active");
      }).catch(() => undefined);
      throw new Error("hook failed");
    });
    await expect(
      buildController().register(buildRegisterBody()),
    ).rejects.toThrow("hook failed");
    expect(await world.users()).toHaveLength(1);
    expect(await world.tenants()).toHaveLength(1);
    expect(stripe.customers.size).toBe(1);
    expect(stripe.liveSubscriptions.size).toBe(1);
    expect((await world.attempts())[0]?.state).toBe("reconciliation_required");
  });

  it("shares the retention identity only after provider cancellation and preserves the marker on hook failure", async () => {
    listen(() => {
      throw new Error("hook failed");
    });
    const observedCancellation: (string | Date | null | undefined)[] = [];
    vi.spyOn(getStripeClient().subscriptions, "cancel").mockImplementation(
      async (id) => {
        const [row] = await world.subscriptions();
        observedCancellation.push(
          row?.domainTransition?.kind,
          row?.deletionStartedAt ?? null,
        );
        return fromPartial(await stripe.cancelSubscription(id));
      },
    );
    const deleted = vi.fn(
      async (_tenantId: string, _context?: TenantDeletionContext) => {
        throw new Error("deletion consumer unavailable");
      },
    );
    RegisterHook(Hook.TENANT_DELETED, deleted);
    try {
      await expect(
        buildController().register(buildRegisterBody()),
      ).rejects.toThrow("hook failed");
      expect(deleted).toHaveBeenCalledOnce();
      const [tenantId, context] = deleted.mock.calls[0];
      const row = await world.subscriptionOf(tenantId);
      if (!row) throw new Error(`No subscription left for ${tenantId}`);
      expect(observedCancellation).toEqual(["cancel", null]);
      expect(stripe.liveSubscriptions.size).toBe(0);
      expect(stripe.customers.size).toBe(0);
      expect(row.domainTransition).toBeNull();
      expect(context?.operationId).toBe(
        JSON.stringify([
          "retention-delete",
          tenantId,
          tenantId,
          row.deletionStartedAt?.toISOString(),
        ]),
      );
      expect(context?.operationId).toBe(
        getWorkspaceDeletionOperationId(tenantId, row),
      );
      expect(await world.tenants()).toHaveLength(1);
    } finally {
      UnregisterHook(Hook.TENANT_DELETED, deleted);
    }
  });

  it("retains the cancellation intent without admitting deletion on an unknown provider outcome", async () => {
    listen(() => {
      throw new Error("hook failed");
    });
    vi.spyOn(getStripeClient().subscriptions, "cancel").mockRejectedValue(
      new Error("unknown"),
    );
    await expect(
      buildController().register(buildRegisterBody()),
    ).rejects.toThrow("hook failed");
    const [row] = await world.subscriptions();
    expect(row?.domainTransition?.kind).toBe("cancel");
    expect(row?.deletionStartedAt).toBeFalsy();
    expect(await world.tenants()).toHaveLength(1);
    expect(stripe.customers.size).toBe(1);
  });

  it("cancels the whole registration when a listener fails to write", async () => {
    let atFailure = {};
    listen(async () => {
      atFailure = {
        users: (await world.users()).length,
        tenants: (await world.tenants()).length,
        customers: stripe.customers.size,
        subscriptions: stripe.liveSubscriptions.size,
        paidInvoices: stripe.paidInvoices.size,
      };
      throw new Error("consumer storage is down");
    });

    await expect(
      buildController().register(buildRegisterBody()),
    ).rejects.toThrow("consumer storage is down");

    expect(atFailure).toEqual({
      users: 1,
      tenants: 1,
      customers: 1,
      subscriptions: 1,
      paidInvoices: 0,
    });
    expect(await world.users()).toEqual([]);
    expect(await world.tenants()).toEqual([]);
    expect([...stripe.customers]).toEqual([]);
    expect([...stripe.liveSubscriptions]).toEqual([]);
    expect([...stripe.paidInvoices]).toEqual([]);
    expect(await world.tenantRecords()).toEqual([]);
  });

  it("charges the card only after every listener has run", async () => {
    let paidWhenListenerRan = -1;
    listen(() => {
      paidWhenListenerRan = stripe.paidInvoices.size;
    });

    await buildController().register(buildRegisterBody());

    expect(paidWhenListenerRan).toBe(0);
    expect(stripe.paidInvoices.size).toBe(1);
  });

  it("stops at the first listener that fails", async () => {
    const ran: string[] = [];
    listen(() => {
      ran.push("first");
      throw new Error("nope");
    });
    listen(() => {
      ran.push("second");
    });

    await expect(
      buildController().register(buildRegisterBody()),
    ).rejects.toThrow("nope");

    expect(ran).toEqual(["first"]);
  });

  it("provisions normally when nobody listens", async () => {
    const result = await buildController().register(buildRegisterBody());

    await expect(
      GetModel(TenantModel).get(result.tenantId),
    ).resolves.toBeDefined();
    await expect(GetModel(UserModel).get(result.userId)).resolves.toBeDefined();
  });
});

describe("emitTenantBeingProvisioned", () => {
  it("lets a listener rejection through, unlike a best-effort hook", async () => {
    listen(async () => {
      throw new Error("write failed");
    });

    await expect(
      emitTenantBeingProvisioned({ tenantId: "t1", userId: "u1" }),
    ).rejects.toThrow("write failed");
  });
});
