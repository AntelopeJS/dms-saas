import { GetModel } from "@antelopejs/interface-database-decorators";
import type Stripe from "stripe";
import { getInvoiceLineItemsProviders } from "../../implementations/dms-saas/invoice-line-items";
import { getRequiredInvoiceLineProviders } from "../../config";
import { readInvoiceSubscriptionId } from "../../stripe/payload-shapes";
import { buildInjectionTarget, canInjectIntoInvoice } from "../injection";
import { processInvoiceLineInjection } from "./process";
import { InvoiceLineInjectionModel } from "./task.model";
import type {
  InvoiceLineInjection,
  InvoiceLineInjectionSource,
} from "./task.table";

/** Who registers a cycle invoice, and from which receipt. */
export interface CycleInvoiceAdmission {
  invoice: Stripe.Invoice;
  tenantId: string;
  customerId: string;
  source: InvoiceLineInjectionSource;
  eventId: string | null;
}

/**
 * Register a cycle renewal draft for durable line injection, or nothing when
 * no provider bills it (not a cycle draft, no provider, empty paid window).
 */
export async function registerCycleInvoice(
  admission: CycleInvoiceAdmission,
): Promise<InvoiceLineInjection | null> {
  const providerIds = expectedProviderIds();
  if (providerIds.length === 0) return null;
  if (!canInjectIntoInvoice(admission.invoice)) return null;
  const subscriptionId = readInvoiceSubscriptionId(admission.invoice);
  if (!subscriptionId) return null;
  const target = await buildInjectionTarget(
    admission.invoice,
    admission.tenantId,
    admission.customerId,
  );
  if (!target) return null;
  return GetModel(InvoiceLineInjectionModel).register({
    _id: target.context.invoiceId,
    tenantId: admission.tenantId,
    customerId: admission.customerId,
    stripeSubscriptionId: subscriptionId,
    currency: target.context.currency,
    periodStart: target.context.periodStart,
    periodEnd: target.context.periodEnd,
    source: admission.source,
    eventId: admission.eventId,
    providerIds,
  });
}

/**
 * Providers a new cycle invoice must wait for: the configured ones, so a
 * provider not yet loaded when invoice.created arrives is waited for rather
 * than billed as no usage, plus those registered right now.
 */
function expectedProviderIds(): string[] {
  const required = getRequiredInvoiceLineProviders();
  const registered = getInvoiceLineItemsProviders().map(
    (provider) => provider.id,
  );
  return [...new Set([...required, ...registered])].sort();
}

/**
 * invoice.created for a cycle renewal draft.
 *
 * Acknowledges only when the task carries `suspendedAt` — Stripe was read back
 * with the draft at `auto_advance=false`. Every other outcome throws, including
 * an operator hand-off reached before any suspension (the invoice was already
 * finalized or is not the registered one): that receipt stays unresolved and
 * visible. Stripe documents that it holds automatic finalization while
 * invoice.created is unacknowledged (up to 72 hours); that is the only
 * protection before suspension is proven, not a guarantee — a durable outage
 * before suspension can still let Stripe finalize. The durable task, not a
 * redelivery, completes the work, and closes the receipt once suspended.
 */
export async function admitCycleInvoice(
  admission: CycleInvoiceAdmission,
): Promise<void> {
  const registered = await registerCycleInvoice(admission);
  if (!registered) return;
  const task = await processInvoiceLineInjection(registered._id);
  if (task?.suspendedAt) return;
  const why =
    task?.state === "needs_operator"
      ? `operator required before suspension (${task.reason})`
      : `suspension not confirmed yet (${task?.lastError ?? "held by another worker"}); the recovery task retries it`;
  throw new Error(`Invoice ${registered._id}: ${why}`);
}
