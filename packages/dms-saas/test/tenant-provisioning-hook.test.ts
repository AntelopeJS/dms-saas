import { HTTPResult } from "@antelopejs/interface-api";
import {
  Hook,
  RegisterHook,
  UnregisterHook,
  type TenantDeletionContext,
} from "@antelopejs/interface-dms/hooks";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  emitTenantBeingProvisioned,
  type TenantBeingProvisionedPayload,
} from "../src/hooks/tenant-provisioning";
import { internal as lifecycle } from "../src/implementations/dms-saas/workspace-lifecycle";
import type { WorkspaceLifecycleMessage } from "@antelopejs/interface-dms-saas/workspace-lifecycle";
import type {
  LifecycleDelivery,
  WorkspaceProvisioningState,
} from "../src/operator-actions/db/lifecycle-delivery.table";
import type { ProvisioningAttempt } from "../src/workspaces/db/provisioning-attempt.table";
import type { SubscriptionTransition, TenantSubscription } from "../src/db";
import { getWorkspaceDeletionOperationId } from "../src/workspaces/deletion";
import {
  isWorkspaceProvisioningCommitted,
  reconcileWorkspaceLifecycleDeliveries,
} from "../src/operator-actions/lifecycle-outbox";

/**
 * The registration flow driven end to end against in-memory infrastructure:
 * these tests are what stands in for a first consumer, so they assert the
 * state the world is left in — who exists, what still bills — rather than
 * which function was called.
 */

interface FakeWorld {
  users: Map<string, string>;
  tenants: Map<string, string>;
  stripeCustomers: Set<string>;
  liveSubscriptions: Set<string>;
  paidInvoices: Set<string>;
  tenantRows: Map<string, number>;
  trials: Set<string>;
}

interface TenantInsertInput {
  _id: string;
  name: string;
}

const world: FakeWorld = {
  users: new Map(),
  tenants: new Map(),
  stripeCustomers: new Set(),
  liveSubscriptions: new Set(),
  paidInvoices: new Set(),
  tenantRows: new Map(),
  trials: new Set(),
};

const PLAN = {
  _id: "plan_pro",
  name: "Pro",
  audience: "any",
  isActive: true,
  isDeleted: false,
  trialDays: 0,
  billingMode: "flat",
  paymentProviderRefs: { stripePriceId: "price_pro" },
};

let sequence = 0;
const deliveries = new Map<string, LifecycleDelivery>();
const owners = new Map<string, string>();
const attempts = new Map<string, ProvisioningAttempt>();
const trialIdentities = new Map<string, string>();
const subscriptions = new Map<string, TenantSubscription>();
const admission = vi.hoisted(() => ({ close: vi.fn() }));

vi.mock("@antelopejs/interface-dms/tenant-lifecycle", () => ({
  closeTenantLifecycleAdmission: (...args: unknown[]) =>
    admission.close(...args),
  runTenantLifecycleOperation: async (
    _tenantId: string,
    work: () => Promise<unknown>,
  ) => work(),
}));

function nextId(prefix: string): string {
  sequence += 1;
  return `${prefix}_${sequence}`;
}

function countRow(tenantId: string): void {
  world.tenantRows.set(tenantId, (world.tenantRows.get(tenantId) ?? 0) + 1);
}

const stripeFake = {
  customers: {
    create: async () => {
      const id = nextId("cus");
      world.stripeCustomers.add(id);
      return { id };
    },
    update: async () => ({}),
    del: async (id: string) => {
      world.stripeCustomers.delete(id);
      return {};
    },
    listTaxIds: async () => ({ data: [] }),
    deleteTaxId: async () => ({}),
    createTaxId: async () => ({}),
  },
  paymentMethods: {
    attach: async () => ({}),
    retrieve: async () => ({
      card: { fingerprint: "fp_test" },
      billing_details: { address: null },
    }),
  },
  subscriptions: {
    create: async () => {
      const id = nextId("sub");
      world.liveSubscriptions.add(id);
      // The first invoice is created unpaid (payment_behavior:
      // default_incomplete) and settled later through invoices.pay.
      return {
        id,
        current_period_end: 1893456000,
        latest_invoice: nextId("inv"),
      };
    },
    cancel: async (id: string) => {
      world.liveSubscriptions.delete(id);
      return {};
    },
  },
  invoices: {
    retrieve: async (id: string) => ({
      status: world.paidInvoices.has(id) ? "paid" : "open",
    }),
    pay: async (id: string) => {
      world.paidInvoices.add(id);
      return {};
    },
  },
};

const modelFakes: Record<string, (tenantId?: string) => unknown> = {
  ProvisioningAttemptModel: () => ({
    insert: async (row: ProvisioningAttempt) => {
      attempts.set(row._id, { ...row });
      return [row._id];
    },
    get: async (id: string) => attempts.get(id),
    advance: async (
      current: ProvisioningAttempt,
      patch: Partial<ProvisioningAttempt>,
    ) => Object.assign(current, patch),
  }),
  TrialIdentityModel: () => ({
    reserve: async (id: string, tenantId: string) => {
      if (trialIdentities.has(id)) return trialIdentities.get(id) === tenantId;
      trialIdentities.set(id, tenantId);
      return true;
    },
    releaseUnused: async (id: string, tenantId: string) => {
      if (trialIdentities.get(id) === tenantId) trialIdentities.delete(id);
    },
  }),
  LifecycleDeliveryModel: () => ({
    insert: async (row: LifecycleDelivery) => {
      if (deliveries.has(row._id)) throw new Error("duplicate");
      deliveries.set(row._id, { ...row });
    },
    get: async (id: string) => deliveries.get(id),
    transitionProvisioning: async (
      id: string,
      expected: WorkspaceProvisioningState,
      next: WorkspaceProvisioningState,
      invoiceId?: string | null,
    ) => {
      const row = deliveries.get(id);
      if (row?.provisioningState === next) return;
      if (!row || row.provisioningState !== expected)
        throw new Error("Workspace provisioning state changed");
      row.provisioningState = next;
      if (invoiceId !== undefined) row.provisioningInvoiceId = invoiceId;
      if (next === "cancelled") row.status = "succeeded";
    },
    delete: async (id: string) => deliveries.delete(id),
    findByOperation: async (id: string) =>
      [...deliveries.values()].filter((row) => row.operationId === id),
    findReplayable: async () =>
      [...deliveries.values()].filter((row) => row.status !== "succeeded"),
    markSucceeded: async (delivery: LifecycleDelivery) => {
      const row = deliveries.get(delivery._id);
      if (row) row.status = "succeeded";
    },
    markFailed: async (delivery: LifecycleDelivery) => {
      const row = deliveries.get(delivery._id);
      if (row && row.status !== "succeeded") row.status = "failed";
    },
  }),
  PlanModel: () => ({ get: async () => PLAN }),
  TenantModel: () => ({
    get: async (id: string) =>
      world.tenants.has(id) ? { _id: id } : undefined,
    insert: async (rows: TenantInsertInput[]) => {
      const id = rows[0]._id;
      expect(await isWorkspaceProvisioningCommitted(id)).toBe(false);
      world.tenants.set(id, rows[0]?.name ?? "");
      return [id];
    },
    delete: async (id: string) => {
      world.tenants.delete(id);
    },
  }),
  TrialConsumptionModel: () => ({
    existsForIdentity: async () => false,
    insert: async () => {
      const id = nextId("trial");
      world.trials.add(id);
      return [id];
    },
    delete: async (id: string) => {
      world.trials.delete(id);
    },
  }),
  TenantSubscriptionModel: (tenantId?: string) => ({
    findOne: async () => subscriptions.get(tenantId ?? ""),
    beginTransition: async (
      row: TenantSubscription,
      intent: SubscriptionTransition,
    ) => {
      if (row.domainTransition || row.deletionStartedAt)
        throw new Error("pending transition");
      row.domainTransition = intent;
    },
    completeTransition: async (
      _id: string,
      operationId: string,
      patch: Partial<TenantSubscription>,
    ) => {
      const row = subscriptions.get(tenantId ?? "");
      if (!row || row.domainTransition?.operationId !== operationId)
        throw new Error("lost admission");
      Object.assign(row, patch, { domainTransition: null });
    },
    insert: async (rows: TenantSubscription[]) => {
      countRow(tenantId ?? "");
      subscriptions.set(tenantId ?? "", { ...rows[0], _id: "row" });
      return ["row"];
    },
    deleteAll: async () => {
      world.tenantRows.delete(tenantId ?? "");
      subscriptions.delete(tenantId ?? "");
    },
  }),
  TenantBillingInfoModel: (tenantId?: string) => ({
    insert: async () => {
      countRow(tenantId ?? "");
      return ["row"];
    },
    deleteAll: async () => {
      world.tenantRows.delete(tenantId ?? "");
    },
  }),
  TenantMemberModel: () => ({ existsByUser: async () => false }),
  UserModel: () => userModelFake,
};

const userModelFake = {
  getByEmail: async (email: string) => {
    const found = [...world.users].find(([, stored]) => stored === email);
    return found ? { _id: found[0], email } : undefined;
  },
  insert: async (rows: { email: string }[]) => {
    const id = nextId("user");
    world.users.set(id, rows[0]?.email ?? "");
    return [id];
  },
  delete: async (id: string) => {
    world.users.delete(id);
  },
  update: async () => ({}),
  get: async (id: string) =>
    world.users.has(id) ? { _id: id, email: world.users.get(id) } : undefined,
};

vi.mock("@antelopejs/interface-database-decorators", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@antelopejs/interface-database-decorators")
    >();
  return {
    ...actual,
    GetModel: (model: { name: string }, tenantId?: string) => {
      const fake = modelFakes[model.name];
      if (!fake) throw new Error(`no fake registered for ${model.name}`);
      return fake(tenantId);
    },
  };
});

vi.mock("../src/stripe/client", () => ({
  getStripeClient: () => stripeFake,
  isStripeConfigured: () => true,
  initStripeClient: () => undefined,
  getStripeWebhookSecret: () => "whsec_test",
}));

vi.mock("@antelopejs/interface-dms/tenant-ownership", () => ({
  applyTenantOwnership: async (
    _model: unknown,
    userId: string,
    tenantId: string,
  ) => {
    owners.set(tenantId, userId);
  },
}));

vi.mock("@antelopejs/interface-core/logging", () => ({
  Logging: {
    Error: () => undefined,
    Warn: () => undefined,
    Info: () => undefined,
  },
}));

const OAUTH_USER = { _id: "user_oauth", email: "oauth@example.com", name: "O" };

vi.mock("@antelopejs/interface-dms/auth", () => ({
  validateTenantAssignmentToken: async () => ({ user: OAUTH_USER }),
  createSession: async () => "session_1",
  generateAccessToken: async () => ({ token: "access", expiresIn: 900 }),
  generateRefreshToken: async () => ({ token: "refresh" }),
  sanitizeUser: async (user: { email: string }) => user,
  getExternalIdentities: async () => [],
}));

vi.mock("../src/billing-state", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/billing-state")>();
  return { ...actual, recomputeTenantBillingState: async () => undefined };
});

const { SaasRegisterApiController } =
  await import("../src/routes/public/register");

interface RegisterBodyInput {
  extras?: unknown;
}

function buildRegisterBody(input: RegisterBodyInput = {}) {
  return {
    email: `owner-${nextId("mail")}@example.com`,
    password: "correct horse battery staple",
    name: "Owner",
    workspaceName: "Acme Studio",
    planId: PLAN._id,
    customerType: "individual" as const,
    paymentMethodId: "pm_test",
    address: { country: "BE" },
    ...input,
  };
}

function buildController() {
  const controller = new SaasRegisterApiController();
  Object.assign(controller, {
    userModel: userModelFake,
    sessionModel: { update: async () => ({}) },
    userAgent: "vitest",
    forwardedFor: "",
  });
  return controller;
}

function resetWorld(): void {
  vi.restoreAllMocks();
  admission.close.mockReset();
  attempts.clear();
  trialIdentities.clear();
  subscriptions.clear();
  deliveries.clear();
  owners.clear();
  PLAN.trialDays = 0;
  world.users.clear();
  world.tenants.clear();
  world.stripeCustomers.clear();
  world.liveSubscriptions.clear();
  world.paidInvoices.clear();
  world.tenantRows.clear();
  world.trials.clear();
}

const listeners: Parameters<typeof UnregisterHook>[1][] = [];

function listen(
  handler: (payload: TenantBeingProvisionedPayload) => Promise<void> | void,
): void {
  const registered = handler as Parameters<typeof RegisterHook>[1];
  RegisterHook(Hook.TENANT_BEING_PROVISIONED, registered);
  listeners.push(registered);
}

beforeEach(resetWorld);

afterEach(() => {
  lifecycle.RegisterWorkspaceLifecycleConsumer.unregister("test.created");
  for (const handler of listeners.splice(0)) {
    UnregisterHook(Hook.TENANT_BEING_PROVISIONED, handler);
  }
});

describe("tenant-being-provisioned hook", () => {
  it("delivers created only with committed ownership, records, hooks and payment", async () => {
    let hookFinished = false;
    listen(() => {
      hookFinished = true;
      expect([...deliveries.values()]).toEqual([
        expect.objectContaining({ provisioningState: "preparing" }),
      ]);
    });
    const consume = vi.fn(async (message: WorkspaceLifecycleMessage) => {
      expect(hookFinished).toBe(true);
      expect(world.users.has(owners.get(message.tenantId) ?? "")).toBe(true);
      expect(world.tenantRows.get(message.tenantId)).toBe(2);
      expect(world.paidInvoices.size).toBe(1);
      return { receiptId: message.operationId };
    });
    lifecycle.RegisterWorkspaceLifecycleConsumer.register("test.created", {
      name: "test.created",
      transitions: ["created"],
      consume,
    });
    await buildController().register(buildRegisterBody());
    expect(consume).toHaveBeenCalledOnce();
    expect(
      [...deliveries.values()].every((row) => row.status === "succeeded"),
    ).toBe(true);
  });

  it("supports already-paid zero-total invoices without paying again", async () => {
    vi.spyOn(stripeFake.invoices, "retrieve").mockResolvedValue({
      status: "paid",
    });
    const pay = vi.spyOn(stripeFake.invoices, "pay");
    const result = await buildController().register(buildRegisterBody());
    expect(world.tenants.has(result.tenantId)).toBe(true);
    expect(pay).not.toHaveBeenCalled();
    expect(
      [...deliveries.values()].every((row) => row.status === "succeeded"),
    ).toBe(true);
  });

  it("commits trials without paying an invoice", async () => {
    PLAN.trialDays = 14;
    const pay = vi.spyOn(stripeFake.invoices, "pay");
    await buildController().register(buildRegisterBody());
    expect(pay).not.toHaveBeenCalled();
    expect([...deliveries.values()]).toEqual([
      expect.objectContaining({
        transition: "created",
        status: "succeeded",
        provisioningInvoiceId: null,
      }),
    ]);
  });

  it("tombstones the creation intent before rolling back a definitive card decline", async () => {
    vi.spyOn(stripeFake.invoices, "pay").mockRejectedValue(
      Object.assign(new Error("declined"), { type: "StripeCardError" }),
    );
    await expect(
      buildController().register(buildRegisterBody()),
    ).rejects.toThrow("declined");
    expect([...deliveries.values()]).toEqual([
      expect.objectContaining({ provisioningState: "cancelled" }),
    ]);
    expect(world.tenants.size).toBe(0);
    expect(world.users.size).toBe(0);
  });

  it("preserves membership and replays a charge whose successful response was lost", async () => {
    vi.spyOn(stripeFake.invoices, "pay").mockImplementation(async (id) => {
      world.paidInvoices.add(id);
      throw new Error("connection lost");
    });
    await expect(
      buildController().register(buildRegisterBody()),
    ).rejects.toThrow("connection lost");
    expect(world.users.size).toBe(1);
    expect(world.tenants.size).toBe(1);
    expect(owners.size).toBe(1);
    await reconcileWorkspaceLifecycleDeliveries();
    expect(
      [...deliveries.values()].every((row) => row.status === "succeeded"),
    ).toBe(true);
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
    expect([...attempts.values()][0]).not.toHaveProperty("extras");
    expect(JSON.stringify([...attempts.values()])).not.toContain("podcast");
  });

  it("runs while the workspace is already there to be written against", async () => {
    const workspaceAtHookTime: { tenant?: string; user?: string } = {};
    listen((payload) => {
      workspaceAtHookTime.tenant = world.tenants.get(payload.tenantId);
      workspaceAtHookTime.user = world.users.get(payload.userId);
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

    // The hook contract types `extras` as a required object: a listener always
    // gets one to read, empty rather than undefined, so it never has to guard.
    expect(seen[0]?.extras).toEqual({});
  });

  it("retains provider and account evidence when a customer creation response is lost", async () => {
    vi.spyOn(stripeFake.customers, "create").mockImplementationOnce(
      async () => {
        world.stripeCustomers.add("unknown-customer");
        throw new Error("customer acknowledgement lost");
      },
    );
    await expect(
      buildController().register(buildRegisterBody()),
    ).rejects.toThrow("customer acknowledgement lost");
    expect(world.users.size).toBe(1);
    expect(world.stripeCustomers.has("unknown-customer")).toBe(true);
    expect([...attempts.values()]).toEqual([
      expect.objectContaining({
        state: "reconciliation_required",
        stripeCustomerId: null,
      }),
    ]);
  });

  it("does not destructively roll back while tenant closure is incomplete", async () => {
    listen(() => {
      throw new Error("hook failed");
    });
    admission.close.mockRejectedValue(new Error("producer still active"));
    await expect(
      buildController().register(buildRegisterBody()),
    ).rejects.toThrow("hook failed");
    expect(world.users.size).toBe(1);
    expect(world.tenants.size).toBe(1);
    expect(world.stripeCustomers.size).toBe(1);
    expect(world.liveSubscriptions.size).toBe(1);
    expect([...attempts.values()][0].state).toBe("reconciliation_required");
  });

  it("shares the retention identity only after provider cancellation and preserves the marker on hook failure", async () => {
    listen(() => {
      throw new Error("hook failed");
    });
    const cancel = stripeFake.subscriptions.cancel;
    const observedCancellation: unknown[] = [];
    vi.spyOn(stripeFake.subscriptions, "cancel").mockImplementation(
      async (id) => {
        const row = [...subscriptions.values()][0];
        observedCancellation.push(
          row.domainTransition?.kind,
          row.deletionStartedAt ?? null,
        );
        return cancel(id);
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
      const row = subscriptions.get(tenantId)!;
      expect(observedCancellation).toEqual(["cancel", null]);
      expect(world.liveSubscriptions.size).toBe(0);
      expect(world.stripeCustomers.size).toBe(0);
      expect(row.domainTransition).toBeNull();
      expect(context?.operationId).toBe(
        JSON.stringify([
          "retention-delete",
          tenantId,
          "row",
          row.deletionStartedAt!.toISOString(),
        ]),
      );
      expect(context?.operationId).toBe(
        getWorkspaceDeletionOperationId(tenantId, row),
      );
      expect(world.tenants.size).toBe(1);
    } finally {
      UnregisterHook(Hook.TENANT_DELETED, deleted);
    }
  });

  it("retains the cancellation intent without admitting deletion on an unknown provider outcome", async () => {
    listen(() => {
      throw new Error("hook failed");
    });
    vi.spyOn(stripeFake.subscriptions, "cancel").mockRejectedValue(
      new Error("unknown"),
    );
    await expect(
      buildController().register(buildRegisterBody()),
    ).rejects.toThrow("hook failed");
    const row = [...subscriptions.values()][0];
    expect(row.domainTransition?.kind).toBe("cancel");
    expect(row.deletionStartedAt).toBeFalsy();
    expect(world.tenants.size).toBe(1);
    expect(world.stripeCustomers.size).toBe(1);
  });

  it("cancels the whole registration when a listener fails to write", async () => {
    const atFailure: Record<string, number> = {};
    listen(() => {
      // Recorded before throwing: without it, the assertions below would also
      // pass on a registration that never got as far as creating anything.
      atFailure.users = world.users.size;
      atFailure.tenants = world.tenants.size;
      atFailure.customers = world.stripeCustomers.size;
      atFailure.subscriptions = world.liveSubscriptions.size;
      atFailure.paidInvoices = world.paidInvoices.size;
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
      // The card is charged after listeners, so a listener that fails rolls a
      // workspace back that was never billed — no refund to chase.
      paidInvoices: 0,
    });
    expect([...world.users.keys()]).toEqual([]);
    expect([...world.tenants.keys()]).toEqual([]);
    expect([...world.stripeCustomers]).toEqual([]);
    expect([...world.liveSubscriptions]).toEqual([]);
    expect([...world.paidInvoices]).toEqual([]);
    expect([...world.tenantRows.keys()]).toEqual([]);
  });

  it("charges the card only after every listener has run", async () => {
    let paidWhenListenerRan = -1;
    listen(() => {
      paidWhenListenerRan = world.paidInvoices.size;
    });

    await buildController().register(buildRegisterBody());

    // Nothing billed while listeners run: the charge is the last step, so a
    // listener still holds the power to cancel a not-yet-paid registration.
    expect(paidWhenListenerRan).toBe(0);
    // And it does happen, exactly once, once everything else has succeeded.
    expect(world.paidInvoices.size).toBe(1);
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

    expect(world.tenants.has(result.tenantId)).toBe(true);
    expect(world.users.has(result.userId)).toBe(true);
  });
});

describe("the OAuth-entry path carries the same capture", () => {
  function buildFinalizeBody(extras?: unknown) {
    const {
      email: _email,
      password: _password,
      ...shared
    } = buildRegisterBody();
    return { ...shared, tenant_assignment_token: "tat_test", extras };
  }

  it("answers the token pair the frontend server opens a session from", async () => {
    // The completion screen posts this call through the loader's
    // `/auth/establish`, which reads exactly these fields to write its session
    // cookie. A finalize that stopped returning them would provision a
    // workspace and leave the owner who just paid for it signed out.
    const response = await buildController().finalize(buildFinalizeBody());

    expect(response).toEqual({
      token_type: "Bearer",
      access_token: "access",
      expires_in: 900,
      refresh_token: "refresh",
      user: OAUTH_USER,
    });
  });

  it("hands the listener the account that entered through OAuth", async () => {
    const seen: TenantBeingProvisionedPayload[] = [];
    listen((payload) => {
      seen.push(payload);
    });

    await buildController().finalize(buildFinalizeBody({ referral: "ads" }));

    expect(seen[0]?.userId).toBe(OAUTH_USER._id);
    expect(seen[0]?.extras).toEqual({ referral: "ads" });
  });

  it("rolls the workspace back but keeps the account it did not create", async () => {
    world.users.set(OAUTH_USER._id, OAUTH_USER.email);
    listen(() => {
      throw new Error("consumer storage is down");
    });

    await expect(
      buildController().finalize(buildFinalizeBody()),
    ).rejects.toThrow("consumer storage is down");

    expect([...world.tenants.keys()]).toEqual([]);
    expect([...world.stripeCustomers]).toEqual([]);
    // The account predates this registration: rolling it back would delete
    // someone who signed in through OAuth and merely failed to buy a plan.
    expect([...world.users.keys()]).toEqual([OAUTH_USER._id]);
  });

  it("applies the same limits to the extras it accepts", async () => {
    const error = await buildController()
      .finalize(buildFinalizeBody({ bio: "x".repeat(5000) }))
      .catch((thrown: unknown) => thrown);

    expect(error).toMatchObject({
      status: 400,
      body: "saas.errors.registration.extras_too_large",
    });
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

describe("extras validation on the public endpoint", () => {
  async function expectRejection(extras: unknown, message: string) {
    const error = await buildController()
      .register(buildRegisterBody({ extras }))
      .catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(HTTPResult);
    expect(error).toMatchObject({ status: 400, body: message });
    expect([...world.users.keys()]).toEqual([]);
    expect([...world.tenants.keys()]).toEqual([]);
  }

  it("refuses a payload that is not a plain object", async () => {
    await expectRejection(
      ["referral", "podcast"],
      "saas.errors.registration.extras_invalid",
    );
  });

  it("refuses a payload past the size limit", async () => {
    await expectRejection(
      { bio: "x".repeat(5000) },
      "saas.errors.registration.extras_too_large",
    );
  });

  it("refuses a payload with too many keys", async () => {
    const many = Object.fromEntries(
      Array.from({ length: 65 }, (_, index) => [`k${index}`, 1]),
    );

    await expectRejection(many, "saas.errors.registration.extras_too_complex");
  });

  it("refuses a payload nested deeper than a form ever is", async () => {
    await expectRejection(
      { a: { b: { c: { d: { e: 1 } } } } },
      "saas.errors.registration.extras_too_complex",
    );
  });

  it("refuses a payload reaching for the object prototype", async () => {
    await expectRejection(
      JSON.parse('{"profile":{"__proto__":{"admin":true}}}'),
      "saas.errors.registration.extras_invalid",
    );
  });
});
