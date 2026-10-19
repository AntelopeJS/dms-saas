import type {
  InvoiceLineItemsProvider,
  PreparedInvoiceLineItem,
} from "@antelopejs/interface-dms-saas/invoice-line-items";
import { selectInvoiceLineItemsToCreate } from "@antelopejs/interface-dms-saas/invoice-line-items";
import type Stripe from "stripe";
import { getStripeClient } from "../../stripe/client";
import { readInvoiceSubscriptionId } from "../../stripe/payload-shapes";
import { LINE_KEY_METADATA, LINE_PROVIDER_METADATA } from "../injection";

const INVOICE_ITEMS_PAGE_SIZE = 100;

/** A line this module put, or must put, on an invoice. */
export interface ManagedLine {
  lineKey: string;
  amount: number;
  currency: string;
}

/** One provider's lines accepted for the invoice, or why they cannot be. */
export interface ProviderSelection {
  accepted: PreparedInvoiceLineItem[];
  invalidKeys: string[];
}

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
      lineKey: item.metadata?.[LINE_KEY_METADATA] as string,
      amount: item.amount,
      currency: item.currency,
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

function canonicalLines(lines: readonly ManagedLine[]): string[] {
  return lines
    .map(
      (line) => `${line.lineKey}=${line.amount} ${line.currency.toLowerCase()}`,
    )
    .sort();
}

/** Whether the managed items on Stripe are exactly the expected ones, once each. */
export function managedLinesMatch(
  expected: readonly ManagedLine[],
  actual: readonly ManagedLine[],
): boolean {
  const left = canonicalLines(expected);
  const right = canonicalLines(actual);
  return (
    left.length === right.length && left.every((line, i) => line === right[i])
  );
}

/**
 * What we finalize, in a form a later reader can recompute from Stripe alone:
 * invoice identity, currency, and every managed line's key, amount and
 * currency. A finalized invoice is recognized as ours only by this match.
 */
export function invoiceFingerprint(
  invoice: Stripe.Invoice,
  lines: readonly ManagedLine[],
): string {
  return JSON.stringify({
    invoice: invoice.id,
    customer:
      typeof invoice.customer === "string"
        ? invoice.customer
        : invoice.customer?.id,
    subscription: readInvoiceSubscriptionId(invoice),
    currency: invoice.currency.toLowerCase(),
    lines: canonicalLines(lines),
  });
}
