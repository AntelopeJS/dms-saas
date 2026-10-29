import { Logging } from "@antelopejs/interface-core/logging";
import { CROSS_INSTANCE } from "@antelopejs/interface-database";
import { GetModel } from "@antelopejs/interface-database-decorators";
import { isComplimentarySubscription } from "@antelopejs/interface-dms-saas/billing";
import type Stripe from "stripe";
import { getInvoiceDiscoverySince } from "../../config";
import { TenantSubscriptionModel } from "../../db";
import { getStripeClient } from "../../stripe/client";
import { getRowInstance } from "../../utils";
import { registerCycleInvoice } from "./admission";
import { InvoiceLineInjectionModel } from "./task.model";

const LOG_PREFIX = "[dms-saas:invoice-line-recovery]";
const DRAFT_PAGE_SIZE = 100;
const MS_PER_SECOND = 1000;

interface ManagedSubscription {
  tenantId: string;
  customerId: string;
  stripeSubscriptionId: string;
}

async function managedSubscriptions(): Promise<ManagedSubscription[]> {
  const rows = await GetModel(TenantSubscriptionModel, CROSS_INSTANCE).getAll();
  return rows.flatMap((row) =>
    row.stripeCustomerId &&
    row.stripeSubscriptionId &&
    !isComplimentarySubscription(row) &&
    (row.paidUsagePeriods ?? []).some(
      (period) => period.stripeSubscriptionId === row.stripeSubscriptionId,
    )
      ? [
          {
            tenantId: getRowInstance(row),
            customerId: row.stripeCustomerId,
            stripeSubscriptionId: row.stripeSubscriptionId,
          },
        ]
      : [],
  );
}

/**
 * A draft is only taken over with proof it belongs to this workflow: it is a
 * cycle renewal of a managed subscription, created after the configured
 * activation instant, and nobody has turned its automatic advancement off —
 * a draft someone already holds by hand is left alone.
 */
function isDiscoverable(invoice: Stripe.Invoice, since: Date): boolean {
  return (
    invoice.billing_reason === "subscription_cycle" &&
    invoice.status === "draft" &&
    invoice.auto_advance === true &&
    invoice.created * MS_PER_SECOND >= since.getTime()
  );
}

async function discoverForSubscription(
  managed: ManagedSubscription,
  since: Date,
): Promise<number> {
  const tasks = GetModel(InvoiceLineInjectionModel);
  let registered = 0;
  for await (const invoice of getStripeClient().invoices.list({
    subscription: managed.stripeSubscriptionId,
    customer: managed.customerId,
    status: "draft",
    created: { gte: Math.floor(since.getTime() / MS_PER_SECOND) },
    limit: DRAFT_PAGE_SIZE,
  })) {
    if (!isDiscoverable(invoice, since) || !invoice.id) continue;
    if (await tasks.get(invoice.id)) continue;
    const task = await registerCycleInvoice({
      invoice,
      tenantId: managed.tenantId,
      customerId: managed.customerId,
      source: "discovery",
      eventId: null,
    });
    if (task) registered += 1;
  }
  return registered;
}

/**
 * Register cycle drafts whose invoice.created never produced a task — the
 * receipt or the task insert failed. Disabled until an activation instant is
 * configured: older drafts carry no proof they belong to this workflow.
 */
export async function discoverUnregisteredCycleInvoices(): Promise<number> {
  const since = getInvoiceDiscoverySince();
  if (!since) return 0;
  let registered = 0;
  for (const managed of await managedSubscriptions()) {
    try {
      registered += await discoverForSubscription(managed, since);
    } catch (error) {
      Logging.Error(
        `${LOG_PREFIX} discovery failed for workspace '${managed.tenantId}'`,
        error,
      );
    }
  }
  return registered;
}
