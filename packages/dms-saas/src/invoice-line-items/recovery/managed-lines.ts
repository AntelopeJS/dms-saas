import type {
  InvoiceLineItemsProvider,
  PreparedInvoiceLineItem,
} from "@antelopejs/interface-dms-saas/invoice-line-items";
import { selectInvoiceLineItemsToCreate } from "@antelopejs/interface-dms-saas/invoice-line-items";
import type Stripe from "stripe";
import { getStripeClient } from "../../stripe/client";
import { readInvoiceSubscriptionId } from "../../stripe/payload-shapes";
import { LINE_KEY_METADATA, LINE_PROVIDER_METADATA } from "../injection";
import type { InvoiceLineInjection } from "./task.table";

const INVOICE_ITEMS_PAGE_SIZE = 100;
const MS_PER_SECOND = 1000;
const DRAFT = "draft";

/** A line this module put, or must put, on an invoice: everything that identifies and prices it. */
export interface ManagedLine {
  provider: string;
  lineKey: string;
  amount: number;
  currency: string;
  periodStart: number;
  periodEnd: number;
}

/** One provider's lines accepted for the invoice, or why they cannot be. */
export interface ProviderSelection {
  accepted: PreparedInvoiceLineItem[];
  invalidKeys: string[];
}

/** How the managed items on Stripe compare with what the task expects. */
export type LinesComparison =
  | "match"
  | "missing_only"
  | "duplicate"
  | "unexpected_or_changed";

/** Every invoice item of the draft, all pages. Foreign items are read, never touched. */
export async function listInvoiceItems(
  invoiceId: string,
): Promise<Stripe.InvoiceItem[]> {
  const items: Stripe.InvoiceItem[] = [];
  for await (const item of getStripeClient().invoiceItems.list({
    invoice: invoiceId,
    limit: INVOICE_ITEMS_PAGE_SIZE,
  })) {
    items.push(item);
  }
  return items;
}

/** Items carrying this module's provider and line key metadata. */
export function managedLinesOf(
  items: readonly Stripe.InvoiceItem[],
): ManagedLine[] {
  return items
    .filter(
      (item) =>
        typeof item.metadata?.[LINE_KEY_METADATA] === "string" &&
        typeof item.metadata?.[LINE_PROVIDER_METADATA] === "string",
    )
    .map((item) => ({
      provider: item.metadata?.[LINE_PROVIDER_METADATA] as string,
      lineKey: item.metadata?.[LINE_KEY_METADATA] as string,
      amount: item.amount,
      currency: item.currency.toLowerCase(),
      periodStart: item.period?.start ?? 0,
      periodEnd: item.period?.end ?? 0,
    }));
}

/** Accept a provider's lines with the same rules as before, without dedup against Stripe. */
export function selectProviderLines(
  provider: InvoiceLineItemsProvider,
  lines: Parameters<typeof selectInvoiceLineItemsToCreate>[1],
): ProviderSelection {
  const selection = selectInvoiceLineItemsToCreate(
    provider.id,
    lines,
    new Set(),
  );
  return {
    accepted: selection.accepted,
    invalidKeys: selection.skipped
      .filter(
        (line) => line.reason === "invalid" || line.reason === "duplicate_key",
      )
      .map((line) => line.lineKey),
  };
}

function toSeconds(date: Date): number {
  return Math.floor(new Date(date).getTime() / MS_PER_SECOND);
}

/** The line as the task requires it on Stripe: its window and currency come from the task. */
export function expectedLine(
  task: InvoiceLineInjection,
  provider: string,
  prepared: PreparedInvoiceLineItem,
): ManagedLine {
  return {
    provider,
    lineKey: prepared.lineKey,
    amount: prepared.item.amountCents,
    currency: task.currency.toLowerCase(),
    periodStart: toSeconds(task.periodStart),
    periodEnd: toSeconds(task.periodEnd),
  };
}

function canonical(line: ManagedLine): string {
  return [
    line.provider,
    line.lineKey,
    line.amount,
    line.currency,
    line.periodStart,
    line.periodEnd,
  ].join("|");
}

/**
 * Compare Stripe's managed items with the expected ones. Only absent keys are
 * worth waiting for; a key present twice, or present with another amount,
 * currency, period or provider, is a fact no retry will change.
 */
export function compareManagedLines(
  expected: readonly ManagedLine[],
  actual: readonly ManagedLine[],
): LinesComparison {
  const keys = actual.map((line) => line.lineKey);
  if (new Set(keys).size !== keys.length) return "duplicate";
  const wanted = new Map(
    expected.map((line) => [line.lineKey, canonical(line)]),
  );
  for (const line of actual) {
    if (wanted.get(line.lineKey) !== canonical(line))
      return "unexpected_or_changed";
  }
  return actual.length === expected.length ? "match" : "missing_only";
}

/**
 * Why a Stripe invoice is not the one the task was registered for, or null.
 * Compared with the task — never with an earlier snapshot of the invoice,
 * which could itself already have been changed.
 */
export function identityMismatch(
  invoice: Stripe.Invoice,
  task: InvoiceLineInjection,
): string | null {
  const customer =
    typeof invoice.customer === "string"
      ? invoice.customer
      : invoice.customer?.id;
  if (invoice.id !== task._id) return "invoice";
  if (customer !== task.customerId) return "customer";
  if (readInvoiceSubscriptionId(invoice) !== task.stripeSubscriptionId)
    return "subscription";
  if (invoice.currency.toLowerCase() !== task.currency.toLowerCase())
    return "currency";
  return null;
}

/** A draft whose automatic finalization is off. */
export function isSuspendedDraft(invoice: Stripe.Invoice): boolean {
  return invoice.status === DRAFT && invoice.auto_advance === false;
}

/**
 * What we finalize, recomputable from the task and Stripe alone: the task's
 * invoice identity and window, and every managed line's provider, key,
 * amount, currency and period.
 */
export function invoiceFingerprint(
  task: InvoiceLineInjection,
  lines: readonly ManagedLine[],
): string {
  return JSON.stringify({
    invoice: task._id,
    customer: task.customerId,
    subscription: task.stripeSubscriptionId,
    currency: task.currency.toLowerCase(),
    periodStart: toSeconds(task.periodStart),
    periodEnd: toSeconds(task.periodEnd),
    providers: [...task.providerIds].sort(),
    lines: lines.map(canonical).sort(),
  });
}
