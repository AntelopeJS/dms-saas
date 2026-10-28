import type { RequestContext } from "@antelopejs/interface-api";
import { ImplementInterface } from "@antelopejs/interface-core";
import {
  CROSS_INSTANCE,
  type InstanceId,
} from "@antelopejs/interface-database";
import * as queries from "@antelopejs/interface-database/query";
import { GetModel } from "@antelopejs/interface-database-decorators";
import { SessionModel, UserModel } from "@antelopejs/interface-dms/auth/db";
import {
  RoleModel,
  TenantMemberModel,
  TenantModel,
  tenantsTableName,
} from "@antelopejs/interface-dms/db";
import {
  Hook,
  type HookHandler,
  RegisterHook,
  UnregisterHook,
} from "@antelopejs/interface-dms/hooks";
import * as permissions from "@antelopejs/interface-dms/permissions";
import { fromPartial } from "@total-typescript/shoehorn";
import { afterEach, beforeAll, beforeEach, expect, vi } from "vitest";
import {
  BILLING_SETTINGS_SINGLETON_ID,
  BillingSettingsModel,
  type Plan,
  PlanModel,
  TenantBillingInfoModel,
  TenantBillingStateModel,
  TenantSubscriptionModel,
  TrialConsumptionModel,
} from "../../src/db";
import { LifecycleDeliveryModel } from "../../src/operator-actions/db/lifecycle-delivery.model";
import { isWorkspaceProvisioningCommitted } from "../../src/operator-actions/lifecycle-outbox";
import { SaasRegisterApiController } from "../../src/routes/public/register";
import { getStripeClient } from "../../src/stripe/client";
import { ProvisioningAttemptModel } from "../../src/workspaces/db/provisioning-attempt.model";
import { TrialIdentityModel } from "../../src/workspaces/db/trial-identity.model";
import { implementWithDms } from "./dms";
import { mongoQueries } from "./query-gate";

/**
 * The catalogue's free plan, which every registration lands on. Its Stripe
 * subscription still opens a (zero-total) first invoice, settled last like
 * any other.
 */
export const PLAN = {
  _id: "plan_free",
  name: "Free",
  price: 0,
  order: 0,
  audience: "any",
  isActive: true,
  isDeleted: false,
  isPublic: true,
  trialDays: 0,
  billingMode: "flat",
  paymentProviderRefs: { stripePriceId: "price_free" },
} satisfies Partial<Plan>;

/** A public paid plan a visitor may pick on Pricing. */
export const PAID_PLAN = {
  ...PLAN,
  _id: "plan_pro",
  slug: "pro",
  name: "Pro",
  price: 29,
  order: 1,
  paymentProviderRefs: { stripePriceId: "price_pro" },
} satisfies Partial<Plan>;

/** What Stripe holds for the registrations of one test. */
export interface StripeWorld {
  customers: Set<string>;
  liveSubscriptions: Set<string>;
  paidInvoices: Set<string>;
  /** Cancels a subscription the way Stripe does: it no longer bills. */
  cancelSubscription(id: string): Promise<object>;
}

let sequence = 0;

function nextId(prefix: string): string {
  sequence += 1;
  return `${prefix}_${sequence}`;
}

function createStripeWorld(): StripeWorld {
  const world: StripeWorld = {
    customers: new Set(),
    liveSubscriptions: new Set(),
    paidInvoices: new Set(),
    cancelSubscription: async (id) => {
      world.liveSubscriptions.delete(id);
      return {};
    },
  };
  return world;
}

/**
 * Answers every Stripe call a registration makes from {@link StripeWorld}, on
 * the module's current write client. The first invoice is created unpaid
 * (`payment_behavior: default_incomplete`) and settled later through
 * `invoices.pay`.
 */
export function serveStripe(world: StripeWorld): void {
  const stripe = getStripeClient();
  vi.spyOn(stripe.customers, "create").mockImplementation(async () => {
    const id = nextId("cus");
    world.customers.add(id);
    return fromPartial({ id });
  });
  vi.spyOn(stripe.customers, "update").mockResolvedValue(fromPartial({}));
  vi.spyOn(stripe.customers, "del").mockImplementation(async (id) => {
    world.customers.delete(id);
    return fromPartial({});
  });
  vi.spyOn(stripe.customers, "listTaxIds").mockResolvedValue(
    fromPartial({ data: [] }),
  );
  vi.spyOn(stripe.setupIntents, "create").mockResolvedValue(
    fromPartial({ client_secret: "seti_secret" }),
  );
  vi.spyOn(stripe.paymentMethods, "attach").mockResolvedValue(fromPartial({}));
  vi.spyOn(stripe.paymentMethods, "retrieve").mockResolvedValue(
    fromPartial({
      card: { fingerprint: "fp_test" },
      billing_details: { address: null },
    }),
  );
  vi.spyOn(stripe.subscriptions, "create").mockImplementation(async () => {
    const id = nextId("sub");
    world.liveSubscriptions.add(id);
    return fromPartial({
      id,
      items: { data: [{ current_period_end: 1893456000 }] },
      latest_invoice: nextId("inv"),
    });
  });
  vi.spyOn(stripe.subscriptions, "cancel").mockImplementation(async (id) =>
    fromPartial(await world.cancelSubscription(id)),
  );
  vi.spyOn(stripe.invoices, "retrieve").mockImplementation(async (id) =>
    fromPartial({ status: world.paidInvoices.has(id) ? "paid" : "open" }),
  );
  vi.spyOn(stripe.invoices, "pay").mockImplementation(async (id) => {
    world.paidInvoices.add(id);
    return fromPartial({});
  });
}

/** Empties every table a registration writes, and lays the catalogue out again. */
async function resetDatabase(): Promise<void> {
  await Promise.all(
    [
      GetModel(UserModel),
      GetModel(SessionModel),
      GetModel(TenantModel),
      GetModel(TenantMemberModel, CROSS_INSTANCE),
      GetModel(RoleModel, CROSS_INSTANCE),
      GetModel(PlanModel),
      GetModel(BillingSettingsModel),
      GetModel(ProvisioningAttemptModel),
      GetModel(LifecycleDeliveryModel),
      GetModel(TrialIdentityModel),
      GetModel(TrialConsumptionModel),
      GetModel(TenantSubscriptionModel, CROSS_INSTANCE),
      GetModel(TenantBillingInfoModel, CROSS_INSTANCE),
      GetModel(TenantBillingStateModel),
    ].map((model) => model.table.delete().run()),
  );
  await GetModel(PlanModel).insert([PLAN, PAID_PLAN]);
}

/** The tenant rows a query inserts into the DMS tenant inventory. */
function insertedTenantIds(
  stages: Parameters<typeof queries.RunQuery>[0],
): (string | undefined)[] {
  const writesTenants = stages.some(
    (stage) =>
      stage.stage === "table" && stage.options?.id === tenantsTableName,
  );
  if (!writesTenants) return [];
  return stages
    .filter((stage) => stage.stage === "insert")
    .flatMap((stage) => stage.args.flat())
    .map((row) => TenantModel.fromDatabase(row)?._id);
}

const tenantInsertedHandlers: ((tenantId: string) => Promise<void>)[] = [];

/**
 * Runs `handler` as soon as the workspace's row has been inserted into the
 * tenant inventory, before the registration goes on: what another writer
 * covering the new workspace does at that point.
 */
export function onTenantInserted(
  handler: (tenantId: string) => Promise<void>,
): void {
  tenantInsertedHandlers.push(handler);
}

/**
 * Runs the database's queries, checking as each tenant row reaches it that the
 * workspace joins the inventory only while its creation intent still gates it,
 * then handing it to the {@link onTenantInserted} handlers.
 */
const gatedQueries: typeof queries = {
  ...mongoQueries,
  RunQuery: async (stages) => {
    const tenantIds = insertedTenantIds(stages);
    for (const tenantId of tenantIds) {
      expect(await isWorkspaceProvisioningCommitted(tenantId ?? "")).toBe(
        false,
      );
    }
    const result = await mongoQueries.RunQuery(stages);
    for (const tenantId of tenantIds)
      for (const handler of tenantInsertedHandlers)
        await handler(tenantId ?? "");
    return result;
  },
};

/** What the public registration endpoint takes. */
type RegisterBody = Parameters<SaasRegisterApiController["register"]>[0];

/** The body of a password registration that meets every policy. */
export function buildRegisterBody(
  input: Pick<RegisterBody, "extras" | "requestedPlanId"> = {},
) {
  return {
    email: `owner-${nextId("mail")}@example.com`,
    password: "CorrectHorse9!",
    name: "Owner",
    workspaceName: "Acme Studio",
    paymentMethodId: "pm_test",
    ...input,
  };
}

/** The registration controller with the fields the API module computes. */
export function buildController() {
  return Object.assign(new SaasRegisterApiController(), {
    userModel: GetModel(UserModel),
    sessionModel: GetModel(SessionModel),
    userAgent: "vitest",
    forwardedFor: "",
  });
}

/** Reads the world a registration leaves behind: who exists, what still bills. */
export const world = {
  users: () => GetModel(UserModel).getAll(),
  tenants: () => GetModel(TenantModel).getAll(),
  /** The owner memberships of a workspace, or of every workspace. */
  owners: async (tenantId: InstanceId = CROSS_INSTANCE) =>
    (await GetModel(TenantMemberModel, tenantId).getAll()).filter(
      (member) => member.isTenantOwner,
    ),
  deliveries: () => GetModel(LifecycleDeliveryModel).getAll(),
  attempts: () => GetModel(ProvisioningAttemptModel).getAll(),
  subscriptions: () =>
    GetModel(TenantSubscriptionModel, CROSS_INSTANCE).getAll(),
  subscriptionOf: (tenantId: string) =>
    GetModel(TenantSubscriptionModel, tenantId).findOne(),
  /** The subscription and billing rows of a workspace, or of every workspace. */
  tenantRecords: async (tenantId: InstanceId = CROSS_INSTANCE) => [
    ...(await GetModel(TenantSubscriptionModel, tenantId).getAll()),
    ...(await GetModel(TenantBillingInfoModel, tenantId).getAll()),
  ],
  updatePlan: (id: string, patch: Partial<Plan>) =>
    GetModel(PlanModel).update(id, patch),
  /** Caps the free workspaces one card may back, a rule off by default. */
  capFreeWorkspacesPerCard: () =>
    GetModel(BillingSettingsModel).insert({
      _id: BILLING_SETTINGS_SINGLETON_ID,
      maxFreeWorkspacesPerCard: 1,
    }),
};

/** A request carrying a bearer token, as the frontend server sends it. */
export function bearer(token: string): RequestContext {
  return fromPartial<RequestContext>({
    rawRequest: { headers: { authorization: `Bearer ${token}` } },
  });
}

const listeners: HookHandler<Hook.TENANT_BEING_PROVISIONED>[] = [];

/** Listens to `TENANT_BEING_PROVISIONED` for the current test. */
export function listen(
  handler: HookHandler<Hook.TENANT_BEING_PROVISIONED>,
): void {
  RegisterHook(Hook.TENANT_BEING_PROVISIONED, handler);
  listeners.push(handler);
}

/**
 * Drives registrations end to end against the suite's database and Stripe
 * clients, from an empty world before each test. Call it at the top level of
 * a test file, after `useMongoDatabase` (whose query implementation it
 * observes) and `useSuiteStripe`.
 */
export function useRegistrationWorld(): StripeWorld {
  const stripe = createStripeWorld();
  beforeAll(() => {
    implementWithDms(permissions, "implementations/dms/permissions.js");
    ImplementInterface(queries, gatedQueries);
  });
  beforeEach(async () => {
    stripe.customers.clear();
    stripe.liveSubscriptions.clear();
    stripe.paidInvoices.clear();
    serveStripe(stripe);
    await resetDatabase();
  });
  afterEach(() => {
    tenantInsertedHandlers.splice(0);
    for (const handler of listeners.splice(0))
      UnregisterHook(Hook.TENANT_BEING_PROVISIONED, handler);
  });
  return stripe;
}
