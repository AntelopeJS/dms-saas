import { randomUUID } from "node:crypto";
import { GetModel } from "@antelopejs/interface-database-decorators";
import { fromPartial } from "@total-typescript/shoehorn";
import type Stripe from "stripe";
import { describe, expect, it, vi } from "vitest";
import {
  PlanModel,
  StripeWebhookEventModel,
  TenantBillingInfoModel,
  TenantSubscriptionModel,
} from "../src/db";
import { setRuntimeConfig } from "../src/config/runtime";
import { dispatchStripeWebhookEvent } from "../src/stripe/webhook-dispatch";
import { UpcomingInvoicePreviewCacheModel } from "../src/upcoming-invoice/db/preview-cache.model";
import { getUpcomingInvoicePreview } from "../src/upcoming-invoice/preview";
import { captureLogs } from "./helpers/logging";
import { useMongoDatabase } from "./helpers/mongo";
import {
  NOW,
  seconds,
  seedPreviewWorkspace,
  STRIPE_CONFIG,
  SUBSCRIPTION_ID,
  CYCLE_END,
  CYCLE_START,
  usePreviewEnvironment,
} from "./helpers/upcoming-invoice";
import { useSuiteStripe } from "./helpers/stripe";

useMongoDatabase("upcoming-invoice-preview-cache");
const stripe = useSuiteStripe();
const logs = captureLogs();
const previews = usePreviewEnvironment(stripe);

const ONE_HOUR_MS = 3_600_000;

type InvoiceEvent =
  | Stripe.InvoiceCreatedEvent
  | Stripe.InvoiceFinalizedEvent
  | Stripe.InvoicePaidEvent;

function invoiceEvent(
  type: InvoiceEvent["type"],
  customerId: string,
): InvoiceEvent {
  return fromPartial<InvoiceEvent>({
    id: randomUUID(),
    type,
    data: {
      object: {
        object: "invoice",
        id: `in_${randomUUID()}`,
        customer: customerId,
        lines: { object: "list", data: [], has_more: false, url: "" },
        status_transitions: {},
      },
    },
  });
}

function subscriptionUpdatedEvent(
  customerId: string,
): Stripe.CustomerSubscriptionUpdatedEvent {
  return fromPartial<Stripe.CustomerSubscriptionUpdatedEvent>({
    id: randomUUID(),
    type: "customer.subscription.updated",
    data: {
      object: {
        object: "subscription",
        id: SUBSCRIPTION_ID,
        customer: customerId,
        status: "active",
        items: {
          data: [
            {
              current_period_start: seconds(CYCLE_START),
              current_period_end: seconds(CYCLE_END),
            },
          ],
        },
      },
    },
  });
}

function refundUpdatedEvent(
  customerId: string,
): Stripe.ChargeRefundUpdatedEvent {
  const refund = {
    object: "refund",
    id: `re_${randomUUID()}`,
    charge: "ch_current",
    customer: customerId,
    amount: 100,
    currency: "eur",
    status: "pending",
  } as const;
  return fromPartial<Stripe.ChargeRefundUpdatedEvent>({
    id: randomUUID(),
    type: "charge.refund.updated",
    data: { object: refund },
  });
}

describe("upcoming invoice preview cache", () => {
  it("serves a repeated request from cache", async () => {
    const { tenantId } = await seedPreviewWorkspace();

    const first = await getUpcomingInvoicePreview(tenantId);
    vi.setSystemTime(new Date(NOW.getTime() + 60_000));
    const second = await getUpcomingInvoicePreview(tenantId);

    expect(second).toEqual(first);
    expect(previews.createPreview).toHaveBeenCalledOnce();
  });

  it("prices again once the cache lifetime has elapsed", async () => {
    const { tenantId } = await seedPreviewWorkspace();

    await getUpcomingInvoicePreview(tenantId);
    vi.setSystemTime(new Date(NOW.getTime() + ONE_HOUR_MS + 1));
    const refreshed = await getUpcomingInvoicePreview(tenantId);

    expect(previews.createPreview).toHaveBeenCalledTimes(2);
    expect(refreshed).toMatchObject({
      computedAt: new Date(NOW.getTime() + ONE_HOUR_MS + 1).toISOString(),
    });
  });

  it("honors a configured cache lifetime and zero disables it", async () => {
    const { tenantId } = await seedPreviewWorkspace();
    setRuntimeConfig({
      stripe: STRIPE_CONFIG,
      upcomingInvoicePreviewCacheTtlSeconds: 0,
    });

    await getUpcomingInvoicePreview(tenantId);
    await getUpcomingInvoicePreview(tenantId);

    expect(previews.createPreview).toHaveBeenCalledTimes(2);
  });

  it.each([
    [
      "a plan change",
      async (tenantId: string) => {
        const [team] = await GetModel(PlanModel).insert({ price: 99 });
        await GetModel(TenantSubscriptionModel, tenantId).update(tenantId, {
          planId: team,
        });
      },
    ],
    [
      "a billing identity change",
      async (tenantId: string) => {
        await GetModel(TenantBillingInfoModel, tenantId).update(tenantId, {
          billingEmail: "billing@example.test",
        });
      },
    ],
  ])("prices again after %s", async (_label, change) => {
    const { tenantId } = await seedPreviewWorkspace();

    await getUpcomingInvoicePreview(tenantId);
    vi.setSystemTime(new Date(NOW.getTime() + 60_000));
    await change(tenantId);
    await getUpcomingInvoicePreview(tenantId);

    expect(previews.createPreview).toHaveBeenCalledTimes(2);
  });

  it.each([
    "invoice.finalized",
    "invoice.created",
    "customer.subscription.updated",
  ] as const)("prices again after a handled %s webhook", async (type) => {
    const { tenantId, customerId } = await seedPreviewWorkspace();
    const event =
      type === "customer.subscription.updated"
        ? subscriptionUpdatedEvent(customerId)
        : invoiceEvent(type, customerId);

    await getUpcomingInvoicePreview(tenantId);
    vi.setSystemTime(new Date(NOW.getTime() + 1000));
    await dispatchStripeWebhookEvent(event);
    await getUpcomingInvoicePreview(tenantId);

    await expect(
      GetModel(StripeWebhookEventModel).get(event.id),
    ).resolves.toMatchObject({ result: "success" });
    expect(previews.createPreview).toHaveBeenCalledTimes(2);
  });

  it("keeps the cache on an event that does not change the next invoice", async () => {
    const { tenantId, customerId } = await seedPreviewWorkspace();
    const event = refundUpdatedEvent(customerId);
    vi.spyOn(stripe.write.charges, "retrieve").mockResolvedValue(
      fromPartial({ customer: customerId }),
    );

    await getUpcomingInvoicePreview(tenantId);
    vi.setSystemTime(new Date(NOW.getTime() + 1000));
    await dispatchStripeWebhookEvent(event);
    await getUpcomingInvoicePreview(tenantId);

    await expect(
      GetModel(StripeWebhookEventModel).get(event.id),
    ).resolves.toMatchObject({ result: "success" });
    expect(previews.createPreview).toHaveBeenCalledOnce();
  });

  it("does not fail a handled webhook when invalidation fails", async () => {
    const { customerId } = await seedPreviewWorkspace();
    vi.spyOn(
      GetModel(UpcomingInvoicePreviewCacheModel),
      "invalidate",
    ).mockRejectedValue(new Error("database down"));

    await expect(
      dispatchStripeWebhookEvent(invoiceEvent("invoice.paid", customerId)),
    ).resolves.toBeUndefined();
    expect(logs.at("ERROR")).toContainEqual([
      expect.stringContaining("could not invalidate the preview"),
      expect.objectContaining({ message: "database down" }),
    ]);
  });

  it("never lets a preview computed before an invalidation win over it", async () => {
    const tenantId = randomUUID();
    const cache = GetModel(UpcomingInvoicePreviewCacheModel);
    const startedAt = new Date(NOW.getTime() - 1000);
    const preview = {
      status: "absent" as const,
      reason: "no_upcoming_invoice" as const,
      computedAt: startedAt.toISOString(),
    };

    await cache.invalidate(tenantId, NOW);
    await cache.store({
      tenantId,
      preview,
      sourceVersion: "v1",
      computedAt: startedAt,
    });

    await expect(
      cache.readFresh({
        tenantId,
        sourceVersion: "v1",
        computedNotBefore: new Date(0),
      }),
    ).resolves.toBeNull();
  });
});

describe("upcoming invoice preview configuration", () => {
  it.each([-1, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects cache lifetime %s",
    (ttl) => {
      expect(() =>
        setRuntimeConfig({
          stripe: STRIPE_CONFIG,
          upcomingInvoicePreviewCacheTtlSeconds: ttl,
        }),
      ).toThrow("upcomingInvoicePreviewCacheTtlSeconds");
    },
  );
});
