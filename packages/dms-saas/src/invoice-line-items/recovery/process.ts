import { Logging } from "@antelopejs/interface-core/logging";
import { GetModel } from "@antelopejs/interface-database-decorators";
import { StripeWebhookEventModel } from "@antelopejs/interface-dms-saas/db";
import {
  type InvoiceLineItemsProvider,
  normalizeInvoiceLineItemsResolution,
  type PreparedInvoiceLineItem,
} from "@antelopejs/interface-dms-saas/invoice-line-items";
import type Stripe from "stripe";
import { getInvoiceLineItemsProviders } from "../../implementations/dms-saas/invoice-line-items";
import { getStripeClient } from "../../stripe/client";
import { createInvoiceLineItemWithRetries } from "../injection";
import {
  invoiceFingerprint,
  listInvoiceItems,
  type ManagedLine,
  managedLinesMatch,
  managedLinesOf,
  selectProviderLines,
} from "./managed-lines";
import {
  type InvoiceLineInjectionLease,
  InvoiceLineInjectionModel,
} from "./task.model";
import type {
  InvoiceLineInjection,
  InvoiceLineInjectionState,
} from "./task.table";

const LOG_PREFIX = "[dms-saas:invoice-line-recovery]";
/**
 * Longer than one step's Stripe and provider calls; a holder renews before
 * every Stripe call, so a stalled one is fenced out once this has elapsed.
 */
export const INVOICE_LINE_LEASE_MS = 5 * 60 * 1000;
/** A failed or not-ready step is retried by the next cron run after this. */
const RETRY_AFTER_MS = 5 * 60 * 1000;
const SUSPEND_KEY_PREFIX = "saas-invoice-suspend";
const FINALIZE_KEY_PREFIX = "saas-invoice-finalize";
const INVOICE_CREATED_EVENT = "invoice.created";
const DRAFT = "draft";
const RECOGNIZED_FINAL_STATUSES = new Set(["open", "paid"]);
const MAX_STEPS_PER_RUN = 4;

/** The lease was taken over: this holder must not touch Stripe again. */
class LeaseLostError extends Error {}

type StepOutcome = "advanced" | "wait";
type Step = (lease: InvoiceLineInjectionLease) => Promise<StepOutcome>;

function model(): InvoiceLineInjectionModel {
  return GetModel(InvoiceLineInjectionModel);
}

async function holdLease(lease: InvoiceLineInjectionLease): Promise<void> {
  if (!(await model().renew(lease, INVOICE_LINE_LEASE_MS)))
    throw new LeaseLostError(lease.task._id);
}

async function transition(
  lease: InvoiceLineInjectionLease,
  patch: Partial<InvoiceLineInjection>,
): Promise<StepOutcome> {
  if (!(await model().advance(lease, patch)))
    throw new LeaseLostError(lease.task._id);
  return "advanced";
}

function toOperator(lease: InvoiceLineInjectionLease, reason: string) {
  Logging.Error(
    `${LOG_PREFIX} invoice ${lease.task._id} of workspace '${lease.task.tenantId}' needs an operator: ${reason}`,
  );
  return transition(lease, { state: "needs_operator", reason });
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** A transient failure or a not-ready provider: keep the state, come back later. */
async function retryLater(
  lease: InvoiceLineInjectionLease,
  lastError: string,
): Promise<StepOutcome> {
  await transition(lease, {
    lastError,
    attemptCount: lease.task.attemptCount + 1,
    nextAttemptAt: new Date(Date.now() + RETRY_AFTER_MS),
  });
  return "wait";
}

function retrieveInvoice(invoiceId: string): Promise<Stripe.Invoice> {
  return getStripeClient().invoices.retrieve(invoiceId);
}

function isSuspendedDraft(invoice: Stripe.Invoice): boolean {
  return invoice.status === DRAFT && invoice.auto_advance === false;
}

function stateOf(invoice: Stripe.Invoice): string {
  return `${invoice.status}/auto_advance=${invoice.auto_advance}`;
}

/** registered → suspended, confirmed only by reading Stripe back. */
async function suspend(lease: InvoiceLineInjectionLease): Promise<StepOutcome> {
  const invoiceId = lease.task._id;
  let requestError: string | null = null;
  await holdLease(lease);
  try {
    await getStripeClient().invoices.update(
      invoiceId,
      { auto_advance: false },
      { idempotencyKey: `${SUSPEND_KEY_PREFIX}:${invoiceId}` },
    );
  } catch (error) {
    requestError = errorText(error);
  }
  const invoice = await retrieveInvoice(invoiceId);
  if (isSuspendedDraft(invoice))
    return transition(lease, { state: "suspended", lastError: null });
  if (invoice.status !== DRAFT)
    return toOperator(lease, `finalized_before_suspension:${stateOf(invoice)}`);
  return retryLater(lease, requestError ?? "suspension_not_visible");
}

interface ResolvedLines {
  accepted: Array<{ provider: string; prepared: PreparedInvoiceLineItem }>;
  blocked: string | null;
  notReady: string | null;
}

async function resolveAll(
  task: InvoiceLineInjection,
  providers: readonly InvoiceLineItemsProvider[],
): Promise<ResolvedLines> {
  const resolved: ResolvedLines = {
    accepted: [],
    blocked: null,
    notReady: null,
  };
  const context = {
    tenantId: task.tenantId,
    invoiceId: task._id,
    currency: task.currency,
    periodStart: new Date(task.periodStart),
    periodEnd: new Date(task.periodEnd),
  };
  for (const provider of providers) {
    const resolution = normalizeInvoiceLineItemsResolution(
      await provider.resolve(context),
    );
    if (resolution.status === "blocked") {
      resolved.blocked = `provider_blocked:${provider.id}:${resolution.reason}`;
      return resolved;
    }
    if (resolution.status === "not_ready") {
      resolved.notReady ??= `provider_not_ready:${provider.id}:${resolution.reason}`;
      continue;
    }
    const selection = selectProviderLines(provider, resolution.lines);
    if (selection.invalidKeys.length > 0) {
      resolved.blocked = `provider_invalid_lines:${provider.id}:${selection.invalidKeys.join(",")}`;
      return resolved;
    }
    for (const prepared of selection.accepted)
      resolved.accepted.push({ provider: provider.id, prepared });
  }
  return resolved;
}

function expectedLinesOf(
  resolved: ResolvedLines,
  currency: string,
): ManagedLine[] {
  return resolved.accepted.map(({ prepared }) => ({
    lineKey: prepared.lineKey,
    amount: prepared.item.amountCents,
    currency,
  }));
}

async function createMissingLines(
  lease: InvoiceLineInjectionLease,
  resolved: ResolvedLines,
  existing: readonly ManagedLine[],
): Promise<void> {
  const present = new Set(existing.map((line) => line.lineKey));
  const { task } = lease;
  for (const { provider, prepared } of resolved.accepted) {
    if (present.has(prepared.lineKey)) continue;
    await holdLease(lease);
    await createInvoiceLineItemWithRetries(
      provider,
      {
        customerId: task.customerId,
        context: {
          tenantId: task.tenantId,
          invoiceId: task._id,
          currency: task.currency,
          periodStart: new Date(task.periodStart),
          periodEnd: new Date(task.periodEnd),
        },
      },
      prepared,
    );
  }
}

/** suspended → finalizing once every expected line is read back, and nothing else managed. */
async function injectLines(
  lease: InvoiceLineInjectionLease,
): Promise<StepOutcome> {
  const { task } = lease;
  const invoice = await retrieveInvoice(task._id);
  if (!isSuspendedDraft(invoice))
    return toOperator(lease, `left_suspension:${stateOf(invoice)}`);
  let resolved: ResolvedLines;
  try {
    resolved = await resolveAll(task, getInvoiceLineItemsProviders());
  } catch (error) {
    return retryLater(lease, `provider_failed:${errorText(error)}`);
  }
  if (resolved.blocked) return toOperator(lease, resolved.blocked);
  if (resolved.notReady) return retryLater(lease, resolved.notReady);
  const expected = expectedLinesOf(resolved, invoice.currency);
  const before = managedLinesOf(await listInvoiceItems(task._id));
  const mismatched = before.filter(
    (line) =>
      !expected.some(
        (wanted) =>
          wanted.lineKey === line.lineKey && wanted.amount === line.amount,
      ),
  );
  if (mismatched.length > 0)
    return toOperator(
      lease,
      `foreign_or_changed_managed_lines:${mismatched.map((l) => l.lineKey).join(",")}`,
    );
  await createMissingLines(lease, resolved, before);
  const after = managedLinesOf(await listInvoiceItems(task._id));
  if (!managedLinesMatch(expected, after))
    return retryLater(lease, "managed_lines_not_yet_visible");
  return transition(lease, {
    state: "finalizing",
    fingerprint: invoiceFingerprint(invoice, after),
    lastError: null,
  });
}

/** finalizing → finalized, recognized only by identity and fingerprint. */
async function finalize(
  lease: InvoiceLineInjectionLease,
): Promise<StepOutcome> {
  const { task } = lease;
  let invoice = await retrieveInvoice(task._id);
  let requestError: string | null = null;
  if (invoice.status === DRAFT) {
    await holdLease(lease);
    try {
      await getStripeClient().invoices.finalizeInvoice(
        task._id,
        { auto_advance: true },
        { idempotencyKey: `${FINALIZE_KEY_PREFIX}:${task._id}` },
      );
    } catch (error) {
      requestError = errorText(error);
    }
    invoice = await retrieveInvoice(task._id);
  }
  if (invoice.status === DRAFT)
    return retryLater(lease, requestError ?? "finalization_not_visible");
  if (!RECOGNIZED_FINAL_STATUSES.has(invoice.status ?? ""))
    return toOperator(lease, `finalized_as:${invoice.status}`);
  const lines = managedLinesOf(await listInvoiceItems(task._id));
  if (invoiceFingerprint(invoice, lines) !== task.fingerprint)
    return toOperator(
      lease,
      `finalized_with_external_changes:${invoice.status}`,
    );
  return transition(lease, { state: "finalized", lastError: null });
}

const STEPS: Partial<Record<InvoiceLineInjectionState, Step>> = {
  registered: suspend,
  suspended: injectLines,
  finalizing: finalize,
};

/** Acknowledge the invoice.created receipt once the draft is known suspended. */
async function closeWebhookReceipt(task: InvoiceLineInjection): Promise<void> {
  if (!task.eventId || task.state === "registered") return;
  const staleBefore = new Date(Date.now() - INVOICE_LINE_LEASE_MS);
  await GetModel(StripeWebhookEventModel).resolveTakenOver(
    task.eventId,
    INVOICE_CREATED_EVENT,
    staleBefore,
    `resolved by invoice line injection task (${task.state})`,
  );
}

async function runSteps(lease: InvoiceLineInjectionLease): Promise<void> {
  for (let i = 0; i < MAX_STEPS_PER_RUN; i += 1) {
    const step = STEPS[lease.task.state];
    if (!step) return;
    if ((await step(lease)) === "wait") return;
  }
}

/**
 * Advance one invoice as far as it can go now, under the task's lease.
 *
 * Returns the task as last read. Never throws for Stripe, provider or lease
 * contention problems: they are recorded on the task and retried, so the
 * caller decides from the state alone.
 */
export async function processInvoiceLineInjection(
  invoiceId: string,
): Promise<InvoiceLineInjection | undefined> {
  const current = await model().get(invoiceId);
  if (!current) return undefined;
  const lease = await model().acquire(current, INVOICE_LINE_LEASE_MS);
  if (!lease) return current;
  try {
    await runSteps(lease);
  } catch (error) {
    if (error instanceof LeaseLostError) {
      Logging.Warn(
        `${LOG_PREFIX} invoice ${invoiceId}: lease taken over, stopping`,
      );
      return model().get(invoiceId);
    }
    Logging.Error(`${LOG_PREFIX} invoice ${invoiceId}: step failed`, error);
    await model()
      .advance(lease, {
        lastError: errorText(error),
        attemptCount: lease.task.attemptCount + 1,
        nextAttemptAt: new Date(Date.now() + RETRY_AFTER_MS),
      })
      .catch(() => undefined);
  }
  await model()
    .release(lease)
    .catch(() => undefined);
  const latest = await model().get(invoiceId);
  if (latest)
    await closeWebhookReceipt(latest).catch((error: unknown) => {
      Logging.Warn(
        `${LOG_PREFIX} invoice ${invoiceId}: receipt not closed`,
        error,
      );
    });
  return latest;
}
