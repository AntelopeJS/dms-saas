import { GetModel } from "@antelopejs/interface-database-decorators";
import type Stripe from "stripe";
import { getInvoiceLineItemsProviders } from "../../implementations/dms-saas/invoice-line-items";
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
  if (getInvoiceLineItemsProviders().length === 0) return null;
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
  });
}

/**
 * invoice.created for a cycle renewal draft.
 *
 * Acknowledges only once Stripe was read back with the draft suspended
 * (`auto_advance=false`). Until then it throws: Stripe documents that it
 * holds automatic finalization while invoice.created is unacknowledged (up
 * to 72 hours), which is the only protection before the suspension is
 * confirmed — not a guarantee, and a durable outage before suspension can
 * still let Stripe finalize. The durable task, not a redelivery, completes
 * the work: the event's receipt is closed by the task once suspended.
 */
export async function admitCycleInvoice(
  admission: CycleInvoiceAdmission,
): Promise<void> {
  const registered = await registerCycleInvoice(admission);
  if (!registered) return;
  const task = await processInvoiceLineInjection(registered._id);
  if (task?.state === "registered") {
    throw new Error(
      `Invoice ${registered._id}: suspension not confirmed yet (${task.lastError ?? "held by another worker"}); the recovery task retries it`,
    );
  }
}
