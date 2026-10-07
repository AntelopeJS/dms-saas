import { GetModel } from "@antelopejs/interface-database-decorators";
import {
  CreditNoteModel,
  type Invoice,
  type InvoiceLine,
  InvoiceModel,
  PlanModel,
  TenantSubscriptionModel,
} from "../../db";
import { sumIssuedCredits } from "../../operator-billing/credit-allowance";

/** An invoice row read across workspaces: the workspace rides along. */
export type CrossInstanceInvoice = Invoice & { _instance: string };

interface InvoiceRowInstance {
  table: CrossInstanceInvoice;
}

/** The row a data controller getter is computed for. */
export function invoiceRow(self: unknown): CrossInstanceInvoice {
  return (self as InvoiceRowInstance).table;
}

/**
 * The name of the plan the workspace is on, the subtitle of its invoices.
 *
 * @param tenantId The workspace
 */
export async function workspacePlanName(
  tenantId: string,
): Promise<string | null> {
  const subscription = await GetModel(
    TenantSubscriptionModel,
    tenantId,
  ).findOne();
  if (!subscription?.planId) return null;
  const plan = await GetModel(PlanModel).get(subscription.planId);
  return plan?.name ?? null;
}

/**
 * The seats an invoice bills: the largest quantity among its charged lines,
 * none when every line bills a single unit.
 *
 * @param lines The invoice's lines
 */
export function invoiceSeats(
  lines: readonly InvoiceLine[] | null | undefined,
): number | null {
  const quantities = (lines ?? [])
    .filter((line) => line.amount > 0)
    .map((line) => line.quantity ?? 0);
  const seats = Math.max(0, ...quantities);
  return seats > 1 ? seats : null;
}

/**
 * What the credit notes issued against an invoice took off it, as a negative
 * amount; none when nothing was credited.
 *
 * @param tenantId The invoice's workspace
 * @param invoiceId The invoice row
 */
export async function invoiceCreditedAmount(
  tenantId: string,
  invoiceId: string,
): Promise<number | null> {
  const notes = await GetModel(CreditNoteModel, tenantId).findByInvoice(
    invoiceId,
  );
  const credited = sumIssuedCredits(notes);
  return credited > 0 ? -credited : null;
}

/**
 * The number of the invoice that replaced this one through a revision.
 *
 * @param tenantId The invoice's workspace
 * @param revisionStripeId The Stripe id of the revision, if any
 */
export async function replacingInvoiceNumber(
  tenantId: string,
  revisionStripeId: string | null | undefined,
): Promise<string | null> {
  if (!revisionStripeId) return null;
  const revision = await GetModel(
    InvoiceModel,
    tenantId,
  ).findOneByStripeInvoice(revisionStripeId);
  return revision?.number ?? null;
}
