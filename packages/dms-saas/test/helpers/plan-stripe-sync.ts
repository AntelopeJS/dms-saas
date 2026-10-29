import {
  GetModel,
  toPlainData,
} from "@antelopejs/interface-database-decorators";
import { fromPartial } from "@total-typescript/shoehorn";
import Stripe from "stripe";
import { beforeEach, type MockInstance, vi } from "vitest";
import {
  BILLING_SETTINGS_SINGLETON_ID,
  BillingSettingsModel,
  type Plan,
  PlanModel,
  type PlanProviderRefs,
} from "../../src/db";
import { syncPlanStripeRefs } from "../../src/plans/stripe-sync";
import { readStripeId } from "../../src/stripe/payload-shapes";
import { insertPlan } from "./localized-plans";
import { planRow } from "./plan-row";
import type { SuiteStripe } from "./stripe";

/** What the stand-in Stripe account holds and was asked to write. */
interface StripeAccountFake {
  failingPlanIds: Set<string>;
  products: Map<string, Stripe.Product>;
  prices: Map<string, Stripe.Price>;
  productsByKey: Map<string, Stripe.Product>;
  pricesByKey: Map<string, Stripe.Price>;
  writes: string[];
}

/** The stand-in Stripe account the suite's clients write to. */
export const fake: StripeAccountFake = {
  failingPlanIds: new Set<string>(),
  products: new Map<string, Stripe.Product>(),
  prices: new Map<string, Stripe.Price>(),
  productsByKey: new Map<string, Stripe.Product>(),
  pricesByKey: new Map<string, Stripe.Price>(),
  writes: [],
};

export function resetFake(): void {
  fake.failingPlanIds.clear();
  fake.products.clear();
  fake.prices.clear();
  fake.productsByKey.clear();
  fake.pricesByKey.clear();
  fake.writes.length = 0;
}

/**
 * Stripe's idempotency contract: a key already seen returns the object the
 * first request created, whichever replica sends it.
 */
function idempotent<T>(
  responses: Map<string, T>,
  options: Stripe.RequestOptions | undefined,
  create: () => T,
): T {
  const key = options?.idempotencyKey;
  const replayed = key ? responses.get(key) : undefined;
  if (replayed) return replayed;
  const created = create();
  if (key) responses.set(key, created);
  return created;
}

function assertNotFailing(metadata: Stripe.MetadataParam | undefined): void {
  const planId = metadata?.planId;
  if (planId !== undefined && fake.failingPlanIds.has(String(planId))) {
    throw new Error("Stripe unavailable");
  }
}

function held<T>(objects: Map<string, T>, id: string): T {
  const object = objects.get(id);
  if (!object) throw new Error(`The stand-in Stripe holds no ${id}`);
  return object;
}

/**
 * Makes the products and prices of `client` behave as a Stripe account would
 * for the calls plan syncing makes, recording what they write.
 */
export function installStripeFake(client: Stripe): void {
  vi.spyOn(client.products, "create").mockImplementation(
    async (params, options) => {
      assertNotFailing(params.metadata);
      return fromPartial(
        idempotent(fake.productsByKey, options, () => {
          const product = fromPartial<Stripe.Product>({
            id: `prod_${fake.products.size + 1}`,
            name: params.name,
            description: params.description ?? null,
            tax_code: params.tax_code,
          });
          fake.products.set(product.id, product);
          fake.writes.push(`products.create:${product.id}`);
          return product;
        }),
      );
    },
  );
  vi.spyOn(client.products, "update").mockImplementation(async (id, params) => {
    const product = held(fake.products, id);
    Object.assign(product, params, {
      description: params?.description || null,
    });
    fake.writes.push(`products.update:${id}`);
    return fromPartial(product);
  });
  vi.spyOn(client.prices, "create").mockImplementation(
    async (params, options) => {
      assertNotFailing(params.metadata);
      return fromPartial(
        idempotent(fake.pricesByKey, options, () => {
          const price = fromPartial<Stripe.Price>({
            id: `price_${fake.prices.size + 1}`,
            active: true,
            product: params.product,
            unit_amount: params.unit_amount,
            currency: params.currency,
            recurring: params.recurring,
            metadata: Object.fromEntries(
              Object.entries(params.metadata ?? {}).map(([key, value]) => [
                key,
                String(value),
              ]),
            ),
          });
          fake.prices.set(price.id, price);
          fake.writes.push(`prices.create:${price.id}`);
          return price;
        }),
      );
    },
  );
  vi.spyOn(client.prices, "update").mockImplementation(async (id, params) => {
    const price = held(fake.prices, id);
    Object.assign(price, params);
    fake.writes.push(`prices.update:${id}`);
    return fromPartial(price);
  });
  vi.spyOn(client.prices, "retrieve").mockImplementation(async (id, params) => {
    const price = fake.prices.get(id);
    if (!price) {
      throw new Stripe.errors.StripeInvalidRequestError({
        type: "invalid_request_error",
        code: "resource_missing",
        message: "No such price",
      });
    }
    const isProductExpanded = params?.expand?.includes("product");
    return fromPartial(
      isProductExpanded
        ? {
            ...price,
            product: fake.products.get(readStripeId(price.product) ?? ""),
          }
        : price,
    );
  });
}

export let plans: PlanModel;
export let planUpdate: MockInstance<PlanModel["update"]>;

export function seededPlan(overrides: Partial<Plan> = {}): Plan {
  return planRow({
    _id: "cloud-plan-hobby",
    name: "Hobby",
    slug: "hobby",
    description: "For side projects",
    audience: "any",
    price: 5,
    currency: "EUR",
    interval: "month",
    billingMode: "flat",
    features: [],
    permissions: [],
    inheritsFromPlanId: null,
    trialDays: 0,
    maxMembers: 3,
    isPublic: true,
    paymentProviderRefs: {},
    borderColor: null,
    borderLabel: null,
    order: 20,
    isActive: true,
    isDeleted: false,
    createdAt: new Date("2026-09-01T00:00:00Z"),
    updatedAt: new Date("2026-09-01T00:00:00Z"),
    ...overrides,
  });
}

/**
 * The plans the suite stored, as each was last read or synced. Updating a plan
 * row through the Mongo adapter drops its localized texts, so a sync is handed
 * the plan the previous step returned, not a re-read of the row.
 */
export const known = new Map<string, Plan>();

export async function store(plan: Plan): Promise<Plan> {
  await insertPlan(plan);
  known.set(plan._id, plan);
  return plan;
}

export async function refsOf(planId: string): Promise<PlanProviderRefs> {
  return (await GetModel(PlanModel).get(planId))?.paymentProviderRefs ?? {};
}

export function knownPlan(planId: string): Plan {
  const plan = known.get(planId);
  if (!plan) throw new Error(`Plan ${planId} was not stored`);
  return plan;
}

export async function syncStored(planId: string): Promise<Plan> {
  const synced = await syncPlanStripeRefs(knownPlan(planId), plans);
  known.set(planId, synced);
  return synced;
}

export async function editAndSync(
  planId: string,
  patch: Partial<Plan>,
): Promise<Plan> {
  const plan = knownPlan(planId);
  await GetModel(PlanModel).delete(planId);
  await store(planRow({ ...toPlainData(plan), ...patch }));
  return syncStored(planId);
}

/**
 * Starts every test with an empty plan table, the default billing settings
 * and a Stripe account holding nothing, which `plans` writes through.
 */
export function usePlanStripeSync(stripe: SuiteStripe): void {
  beforeEach(async () => {
    resetFake();
    known.clear();
    installStripeFake(stripe.write);
    plans = GetModel(PlanModel);
    planUpdate = vi.spyOn(plans, "update");
    for (const { _id } of await GetModel(PlanModel).getAll()) {
      await GetModel(PlanModel).delete(_id);
    }
    await GetModel(BillingSettingsModel).delete(BILLING_SETTINGS_SINGLETON_ID);
  });
}
