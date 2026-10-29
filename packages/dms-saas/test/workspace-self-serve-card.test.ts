import { randomUUID } from "node:crypto";
import type { RequestContext } from "@antelopejs/interface-api";
import { GetModel } from "@antelopejs/interface-database-decorators";
import type { User } from "@antelopejs/interface-dms/auth/db";
import { TenantModel } from "@antelopejs/interface-dms/db";
import {
  Hook,
  RegisterHook,
  UnregisterHook,
} from "@antelopejs/interface-dms/hooks";
import * as permissions from "@antelopejs/interface-dms/permissions";
import { fromPartial } from "@total-typescript/shoehorn";
import type Stripe from "stripe";
import {
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  onTestFinished,
  vi,
} from "vitest";
import {
  BILLING_SETTINGS_SINGLETON_ID,
  BillingSettingsModel,
  TenantBillingInfoModel,
  TenantSubscriptionModel,
} from "../src/db";
import { SaasWorkspacesController } from "../src/routes/tenant/workspaces";
import { listFreeWorkspacesBackedByCard } from "../src/workspaces/free-workspaces-per-card";
import {
  addTenantMember,
  createUser,
  implementWithDms,
  tenantRequest,
  useDmsAuth,
} from "./helpers/dms";
import { useMongoDatabase } from "./helpers/mongo";
import { insertPlan } from "./helpers/plans";
import { insertTenant } from "./helpers/workspaces";
import { useSuiteStripe } from "./helpers/stripe";

useMongoDatabase("workspace-self-serve-card");
useDmsAuth();
const stripe = useSuiteStripe();

const FREE_PLAN_ID = "plan-free";
const PAID_PLAN_ID = "plan-pro";
const PAYMENT_METHOD_ID = "pm_card";
const POLICY_OFF = 0;
const ONE_PER_CARD = 1;
const PAYMENT_METHOD_REQUIRED = {
  status: 400,
  body: "saas.errors.workspace.payment_method_required",
};
const COUNTRY_REQUIRED = {
  status: 400,
  body: "saas.errors.billing.country_required",
};
const FREE_CARD_LIMIT = {
  status: 409,
  body: "saas.errors.workspace.free_card_limit_reached",
};
const CREATION_IN_PROGRESS = {
  status: 409,
  body: "saas.errors.workspace.creation_in_progress",
};
const NAME_TOO_LONG = {
  status: 400,
  body: "saas.errors.workspace.name_too_long",
};

beforeAll(async () => {
  implementWithDms(permissions, "implementations/dms/permissions.js");
  await insertPlan({ _id: FREE_PLAN_ID });
  await insertPlan({
    _id: PAID_PLAN_ID,
    price: 12,
    paymentProviderRefs: { stripePriceId: "price_pro" },
  });
});

function paymentMethod(fingerprint: string, country: string | null) {
  return fromPartial<Stripe.Response<Stripe.PaymentMethod>>({
    card: { fingerprint },
    billing_details: { address: country ? { country } : null },
  });
}

function stubStripe(fingerprint: string) {
  vi.spyOn(stripe.write.customers, "update").mockResolvedValue(fromPartial({}));
  vi.spyOn(stripe.write.customers, "listTaxIds").mockResolvedValue(
    fromPartial({ data: [] }),
  );
  vi.spyOn(stripe.write.invoices, "retrieve").mockResolvedValue(
    fromPartial({ status: "paid" }),
  );
  vi.spyOn(stripe.write.subscriptions, "create").mockResolvedValue(
    fromPartial({
      id: "sub_paid",
      start_date: 1_780_000_000,
      items: { data: [{ current_period_end: 1_782_592_000 }] },
      latest_invoice: "invoice",
    }),
  );
  return {
    retrieveCard: vi
      .spyOn(stripe.write.paymentMethods, "retrieve")
      .mockResolvedValue(paymentMethod(fingerprint, "FR")),
    createCustomer: vi
      .spyOn(stripe.write.customers, "create")
      .mockResolvedValue(fromPartial({ id: "cus_created" })),
    attach: vi
      .spyOn(stripe.write.paymentMethods, "attach")
      .mockResolvedValue(fromPartial({})),
  };
}

let fingerprint: string;
let calls: ReturnType<typeof stubStripe>;
let user: User;
let request: RequestContext;

async function setFreeWorkspacesPerCard(limit: number): Promise<void> {
  const settings = GetModel(BillingSettingsModel);
  await settings.delete(BILLING_SETTINGS_SINGLETON_ID);
  await settings.insert({
    _id: BILLING_SETTINGS_SINGLETON_ID,
    maxFreeWorkspacesPerCard: limit,
  });
}

beforeEach(async () => {
  fingerprint = randomUUID();
  calls = stubStripe(fingerprint);
  const currentTenantId = randomUUID();
  await insertTenant(currentTenantId);
  user = await createUser();
  await addTenantMember(currentTenantId, user);
  request = await tenantRequest(user, currentTenantId);
  await setFreeWorkspacesPerCard(ONE_PER_CARD);
});

function createWorkspace(
  planId: string,
  paymentMethodId?: string,
  workspaceName = "Side project",
) {
  return new SaasWorkspacesController().createMine(user, request, {
    workspaceName,
    planId,
    paymentMethodId,
  });
}

async function workspaceCount(): Promise<number> {
  return (await GetModel(TenantModel).getAll()).length;
}

function subscriptionOf(tenantId: string) {
  return GetModel(TenantSubscriptionModel, tenantId).findOne();
}

async function seedFreeWorkspaceOnCard(): Promise<void> {
  const tenantId = randomUUID();
  await GetModel(TenantSubscriptionModel, tenantId).insert({
    _id: tenantId,
    planId: FREE_PLAN_ID,
    status: "active",
    isComplimentary: false,
    cardFingerprint: fingerprint,
    paidUsagePeriods: [],
  });
}

/**
 * Holds every workspace being provisioned, once it is created and before its
 * payment, until `release` is called; stops holding after the test.
 */
function holdProvisioning() {
  let release = () => {};
  let signalReached = () => {};
  const resumed = new Promise<void>((resolve) => {
    release = resolve;
  });
  const reached = new Promise<void>((resolve) => {
    signalReached = resolve;
  });
  const listener = async () => {
    signalReached();
    await resumed;
  };
  RegisterHook(Hook.TENANT_BEING_PROVISIONED, listener);
  onTestFinished(() => UnregisterHook(Hook.TENANT_BEING_PROVISIONED, listener));
  return { reached, release };
}

describe("self-serve workspace creation card rules", () => {
  it("provisions a free workspace without a card when the per-card rule is off", async () => {
    await setFreeWorkspacesPerCard(POLICY_OFF);

    const { tenantId } = await createWorkspace(FREE_PLAN_ID);

    expect(await subscriptionOf(tenantId)).toMatchObject({
      planId: FREE_PLAN_ID,
      cardFingerprint: null,
      stripeCustomerId: null,
    });
    expect(calls.retrieveCard).not.toHaveBeenCalled();
    expect(calls.createCustomer).not.toHaveBeenCalled();
  });

  it("ignores a card sent for a free plan when the per-card rule is off", async () => {
    await setFreeWorkspacesPerCard(POLICY_OFF);
    await seedFreeWorkspaceOnCard();

    const { tenantId } = await createWorkspace(FREE_PLAN_ID, PAYMENT_METHOD_ID);

    expect(await subscriptionOf(tenantId)).toMatchObject({
      cardFingerprint: null,
      stripeCustomerId: null,
    });
    expect(calls.createCustomer).not.toHaveBeenCalled();
    expect(await listFreeWorkspacesBackedByCard(fingerprint)).toHaveLength(1);
  });

  it("asks for a card on a free plan under the per-card rule", async () => {
    const before = await workspaceCount();

    await expect(createWorkspace(FREE_PLAN_ID)).rejects.toMatchObject(
      PAYMENT_METHOD_REQUIRED,
    );
    expect(await workspaceCount()).toBe(before);
  });

  it("verifies a free workspace's card without handing it over to be charged", async () => {
    calls.retrieveCard.mockResolvedValue(paymentMethod(fingerprint, null));

    const { tenantId } = await createWorkspace(FREE_PLAN_ID, PAYMENT_METHOD_ID);

    expect(await subscriptionOf(tenantId)).toMatchObject({
      cardFingerprint: fingerprint,
      stripeCustomerId: null,
    });
    expect(await listFreeWorkspacesBackedByCard(fingerprint)).toEqual([
      tenantId,
    ]);
    expect(calls.createCustomer).not.toHaveBeenCalled();
    expect(calls.attach).not.toHaveBeenCalled();
  });

  it("refuses a free workspace once its card backs as many as allowed", async () => {
    await seedFreeWorkspaceOnCard();
    const before = await workspaceCount();

    await expect(
      createWorkspace(FREE_PLAN_ID, PAYMENT_METHOD_ID),
    ).rejects.toMatchObject(FREE_CARD_LIMIT);
    expect(await workspaceCount()).toBe(before);
  });

  it("refuses a paid plan without a card", async () => {
    const before = await workspaceCount();

    await expect(createWorkspace(PAID_PLAN_ID)).rejects.toMatchObject(
      PAYMENT_METHOD_REQUIRED,
    );
    expect(await workspaceCount()).toBe(before);
  });

  it("provisions a paid workspace with its card to be charged", async () => {
    await seedFreeWorkspaceOnCard();

    const { tenantId } = await createWorkspace(PAID_PLAN_ID, PAYMENT_METHOD_ID);

    expect(calls.attach).toHaveBeenCalledWith(PAYMENT_METHOD_ID, {
      customer: "cus_created",
    });
    expect(calls.createCustomer).toHaveBeenCalledWith(
      expect.objectContaining({
        address: expect.objectContaining({ country: "FR" }),
      }),
      expect.anything(),
    );
    expect(
      await GetModel(TenantBillingInfoModel, tenantId).findOne(),
    ).toMatchObject({ address: expect.objectContaining({ country: "FR" }) });
    expect(await subscriptionOf(tenantId)).toMatchObject({
      planId: PAID_PLAN_ID,
      cardFingerprint: fingerprint,
      stripeCustomerId: "cus_created",
    });
  });

  it("still requires a billing country on a paid plan", async () => {
    calls.retrieveCard.mockResolvedValue(paymentMethod(fingerprint, null));
    const before = await workspaceCount();

    await expect(
      createWorkspace(PAID_PLAN_ID, PAYMENT_METHOD_ID),
    ).rejects.toMatchObject(COUNTRY_REQUIRED);
    expect(await workspaceCount()).toBe(before);
    expect(calls.createCustomer).not.toHaveBeenCalled();
  });

  it("refuses a second creation racing with the same card", async () => {
    const held = holdProvisioning();

    const first = createWorkspace(FREE_PLAN_ID, PAYMENT_METHOD_ID);
    await held.reached;
    await expect(
      createWorkspace(FREE_PLAN_ID, PAYMENT_METHOD_ID),
    ).rejects.toMatchObject(CREATION_IN_PROGRESS);
    held.release();
    await expect(first).resolves.toEqual({ tenantId: expect.any(String) });
    await expect(
      createWorkspace(PAID_PLAN_ID, PAYMENT_METHOD_ID),
    ).resolves.toEqual({ tenantId: expect.any(String) });
  });

  it("refuses a name longer than the forms allow", async () => {
    await expect(
      createWorkspace(PAID_PLAN_ID, PAYMENT_METHOD_ID, "x".repeat(61)),
    ).rejects.toMatchObject(NAME_TOO_LONG);
  });
});
