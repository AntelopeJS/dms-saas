import { Logging } from "@antelopejs/interface-core/logging";
import { GetModel } from "@antelopejs/interface-database-decorators";
import { StripeWebhookEventModel } from "@antelopejs/interface-dms-saas/db";
import {
  type InvoiceLineItemsProvider,
  type InvoiceLineItemsResolution,
  type InvoiceUsageGap,
  normalizeInvoiceLineItemsResolution,
  type PreparedInvoiceLineItem,
} from "@antelopejs/interface-dms-saas/invoice-line-items";
import type Stripe from "stripe";
import { getInvoiceLineItemsProviders } from "../../implementations/dms-saas/invoice-line-items";
import { getStripeClient } from "../../stripe/client";
import { createInvoiceLineItemWithRetries } from "../injection";
import {
  compareManagedLines,
  expectedLine,
  identityMismatch,
  invoiceFingerprint,
  isSuspendedDraft,
  listInvoiceItems,
  type ManagedLine,
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
/**
 * How long after registration lines still missing are waited for; past it
 * the invoice is finalized with the lines available. Longer than a usage
 * provider takes to account for, or write off, the last hours of a cycle.
 */
export const INVOICE_LINE_DEADLINE_MS = 48 * 60 * 60 * 1000;
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

function isPastDeadline(task: InvoiceLineInjection): boolean {
  return (
    Date.now() - new Date(task.createdAt).getTime() >= INVOICE_LINE_DEADLINE_MS
  );
}

/**
 * Stop adding lines and finalize the invoice as it stands, naming what it
 * goes without. The fingerprint is dropped: nothing is verified any more.
 */
function finalizeAnyway(
  lease: InvoiceLineInjectionLease,
  gaps: readonly string[],
): Promise<StepOutcome> {
  return transition(lease, {
    state: "finalizing",
    fingerprint: null,
    usageGaps: [...lease.task.usageGaps, ...gaps],
    lastError: null,
  });
}

/**
 * Logs an invoice finalized with missing usage as one JSON line and tells the
 * providers it was registered with, so they can raise their alert.
 */
function reportUsageGap(task: InvoiceLineInjection): void {
  const gap: InvoiceUsageGap = {
    tenantId: task.tenantId,
    invoiceId: task._id,
    periodStart: new Date(task.periodStart),
    periodEnd: new Date(task.periodEnd),
    reasons: task.usageGaps,
  };
  Logging.Error(
    `${LOG_PREFIX} invoice finalized with missing usage ${JSON.stringify(gap)}`,
  );
  const expected = new Set(task.providerIds);
  for (const provider of getInvoiceLineItemsProviders()) {
    if (!expected.has(provider.id)) continue;
    try {
      provider.onUsageGap?.(gap);
    } catch (error) {
      Logging.Warn(
        `${LOG_PREFIX} provider '${provider.id}' failed to take the usage gap of invoice ${task._id}`,
        error,
      );
    }
  }
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

/** An answer without an invoice is a failed step to retry, never a mismatch. */
async function retrieveInvoice(invoiceId: string): Promise<Stripe.Invoice> {
  const invoice = await getStripeClient().invoices.retrieve(invoiceId);
  if (!invoice) throw new Error(`Stripe returned no invoice for ${invoiceId}`);
  return invoice;
}

function stateOf(invoice: Stripe.Invoice): string {
  return `${invoice.status}/auto_advance=${invoice.auto_advance}`;
}

/** registered → suspended, proven only by reading Stripe back. */
async function suspend(lease: InvoiceLineInjectionLease): Promise<StepOutcome> {
  const invoiceId = lease.task._id;
  const before = await retrieveInvoice(invoiceId);
  const foreign = identityMismatch(before, lease.task);
  if (foreign) return finalizeAnyway(lease, [`identity_mismatch:${foreign}`]);
  if (before.status !== DRAFT)
    return finalizeAnyway(lease, [
      `finalized_before_suspension:${stateOf(before)}`,
    ]);
  let requestError: string | null = null;
  await holdLease(lease);
  try {
    await getStripeClient().invoices.update(
      invoiceId,
      { auto_advance: false },
      { idempotencyKey: `${SUSPEND_KEY_PREFIX}:${invoiceId}` },
    );
  } catch (error) {
    requestError = error instanceof Error ? error.message : String(error);
  }
  const invoice = await retrieveInvoice(invoiceId);
  if (isSuspendedDraft(invoice))
    return transition(lease, {
      state: "suspended",
      suspendedAt: new Date(),
      lastError: null,
    });
  if (invoice.status !== DRAFT)
    return finalizeAnyway(lease, [
      `finalized_before_suspension:${stateOf(invoice)}`,
    ]);
  return retryLater(lease, requestError ?? "suspension_not_visible");
}

interface ResolvedLines {
  expected: ManagedLine[];
  accepted: Array<{ provider: string; prepared: PreparedInvoiceLineItem }>;
  /** Providers still expected to answer: missing, not ready or failing. */
  waiting: string[];
  /** Lines a provider returned that can never be injected. */
  invalid: string[];
}

function contextOf(task: InvoiceLineInjection) {
  return {
    tenantId: task.tenantId,
    invoiceId: task._id,
    currency: task.currency,
    periodStart: new Date(task.periodStart),
    periodEnd: new Date(task.periodEnd),
  };
}

async function resolveOne(
  provider: InvoiceLineItemsProvider,
  task: InvoiceLineInjection,
): Promise<InvoiceLineItemsResolution> {
  try {
    return normalizeInvoiceLineItemsResolution(
      await provider.resolve(contextOf(task)),
    );
  } catch (error) {
    return {
      status: "not_ready",
      reason: `provider_failed:${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/** Ask every provider the task was registered with; a missing one is waited for. */
async function resolveAll(task: InvoiceLineInjection): Promise<ResolvedLines> {
  const resolved: ResolvedLines = {
    expected: [],
    accepted: [],
    waiting: [],
    invalid: [],
  };
  const registered = new Map(
    getInvoiceLineItemsProviders().map((provider) => [provider.id, provider]),
  );
  for (const providerId of task.providerIds) {
    const provider = registered.get(providerId);
    if (!provider) {
      resolved.waiting.push(`provider_missing:${providerId}`);
      continue;
    }
    const resolution = await resolveOne(provider, task);
    if (resolution.status === "not_ready") {
      resolved.waiting.push(
        `provider_not_ready:${provider.id}:${resolution.reason}`,
      );
      continue;
    }
    const selection = selectProviderLines(provider, resolution.lines);
    if (selection.invalidKeys.length > 0)
      resolved.invalid.push(
        `provider_invalid_lines:${provider.id}:${selection.invalidKeys.join(",")}`,
      );
    for (const prepared of selection.accepted) {
      resolved.accepted.push({ provider: provider.id, prepared });
      resolved.expected.push(expectedLine(task, provider.id, prepared));
    }
  }
  return resolved;
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
      { customerId: task.customerId, context: contextOf(task) },
      prepared,
    );
  }
}

/** Why a draft may not be touched further, or null when it is still ours and suspended. */
function draftProblem(
  invoice: Stripe.Invoice,
  task: InvoiceLineInjection,
): string | null {
  const foreign = identityMismatch(invoice, task);
  if (foreign) return `identity_${foreign}`;
  if (!isSuspendedDraft(invoice)) return `left_suspension:${stateOf(invoice)}`;
  return null;
}

/**
 * Creates the lines the draft lacks. Past the deadline a line Stripe keeps
 * refusing is a gap, not a reason to hold the invoice.
 */
async function createLinesOrGap(
  lease: InvoiceLineInjectionLease,
  resolved: ResolvedLines,
  existing: readonly ManagedLine[],
): Promise<string[]> {
  try {
    await createMissingLines(lease, resolved, existing);
    return [];
  } catch (error) {
    if (error instanceof LeaseLostError || !isPastDeadline(lease.task))
      throw error;
    return [
      `managed_lines_create_failed:${error instanceof Error ? error.message : String(error)}`,
    ];
  }
}

/**
 * suspended → finalizing once the expected lines are read back; past the
 * deadline, with whatever lines are available, naming the rest.
 */
async function injectLines(
  lease: InvoiceLineInjectionLease,
): Promise<StepOutcome> {
  const { task } = lease;
  const problem = draftProblem(await retrieveInvoice(task._id), task);
  if (problem) return finalizeAnyway(lease, [problem]);
  const resolved = await resolveAll(task);
  if (resolved.waiting.length > 0 && !isPastDeadline(task))
    return retryLater(lease, resolved.waiting.join("; "));
  const gaps = [...resolved.waiting, ...resolved.invalid];
  const before = managedLinesOf(await listInvoiceItems(task._id));
  const beforeComparison = compareManagedLines(resolved.expected, before);
  if (
    beforeComparison === "duplicate" ||
    beforeComparison === "unexpected_or_changed"
  )
    return finalizeAnyway(lease, [
      ...gaps,
      `managed_lines_${beforeComparison}`,
    ]);
  gaps.push(...(await createLinesOrGap(lease, resolved, before)));
  const after = managedLinesOf(await listInvoiceItems(task._id));
  const comparison = compareManagedLines(resolved.expected, after);
  if (comparison === "missing_only" && !isPastDeadline(task))
    return retryLater(lease, "managed_lines_not_yet_visible");
  if (comparison !== "match") gaps.push(`managed_lines_${comparison}`);
  return transition(lease, {
    state: "finalizing",
    fingerprint: invoiceFingerprint(task, after),
    usageGaps: [...task.usageGaps, ...gaps],
    lastError: null,
  });
}

/** The invoice is ours and still carries exactly what we recorded. */
async function matchesRecord(
  invoice: Stripe.Invoice,
  task: InvoiceLineInjection,
): Promise<boolean> {
  if (identityMismatch(invoice, task)) return false;
  const lines = managedLinesOf(await listInvoiceItems(task._id));
  return invoiceFingerprint(task, lines) === task.fingerprint;
}

/** What changed on a verified draft since its lines were read back. */
async function draftChanges(
  invoice: Stripe.Invoice,
  task: InvoiceLineInjection,
): Promise<string[]> {
  if (!task.fingerprint) return [];
  const problem = draftProblem(invoice, task);
  if (problem) return [`before_finalize:${problem}`];
  return (await matchesRecord(invoice, task))
    ? []
    : ["before_finalize:changed_since_verified"];
}

/**
 * What a finalized invoice carries other than what was recorded; a draft
 * already found changed is not reported changed twice.
 */
async function finalChanges(
  invoice: Stripe.Invoice,
  task: InvoiceLineInjection,
  isRecordTrusted: boolean,
): Promise<string[]> {
  if (!RECOGNIZED_FINAL_STATUSES.has(invoice.status ?? ""))
    return [`finalized_as:${invoice.status}`];
  if (!isRecordTrusted || !task.fingerprint) return [];
  if (await matchesRecord(invoice, task)) return [];
  return [`finalized_with_external_changes:${invoice.status}`];
}

/** Closes the task with its gaps reported, and the reasons it was given. */
async function closeTask(
  lease: InvoiceLineInjectionLease,
  gaps: readonly string[],
): Promise<StepOutcome> {
  await transition(lease, {
    state: "finalized",
    usageGaps: [...new Set([...lease.task.usageGaps, ...gaps])],
    lastError: null,
  });
  if (lease.task.usageGaps.length > 0) reportUsageGap(lease.task);
  return "advanced";
}

/**
 * finalizing → finalized, always. A draft changed since it was verified is
 * finalized all the same, and the change joins the invoice's usage gaps: a
 * missing line costs the customer nothing and is fixed at its source. A
 * draft that is not the registered invoice is never touched: the task is
 * closed on it, its gap reported.
 */
async function finalize(
  lease: InvoiceLineInjectionLease,
): Promise<StepOutcome> {
  const { task } = lease;
  let invoice = await retrieveInvoice(task._id);
  let requestError: string | null = null;
  const gaps: string[] = [];
  const foreign = identityMismatch(invoice, task);
  if (foreign) return closeTask(lease, [`identity_mismatch:${foreign}`]);
  if (invoice.status === DRAFT) {
    gaps.push(...(await draftChanges(invoice, task)));
    await holdLease(lease);
    try {
      await getStripeClient().invoices.finalizeInvoice(
        task._id,
        { auto_advance: true },
        { idempotencyKey: `${FINALIZE_KEY_PREFIX}:${task._id}` },
      );
    } catch (error) {
      requestError = error instanceof Error ? error.message : String(error);
    }
    invoice = await retrieveInvoice(task._id);
  }
  if (invoice.status === DRAFT)
    return retryLater(lease, requestError ?? "finalization_not_visible");
  gaps.push(...(await finalChanges(invoice, task, gaps.length === 0)));
  return closeTask(lease, gaps);
}

const STEPS: Partial<Record<InvoiceLineInjectionState, Step>> = {
  registered: suspend,
  suspended: injectLines,
  finalizing: finalize,
};

/** Acknowledge the invoice.created receipt once the draft is known suspended or finalized. */
async function closeWebhookReceipt(task: InvoiceLineInjection): Promise<void> {
  if (!task.eventId || !(task.suspendedAt || task.state === "finalized"))
    return;
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
        lastError: error instanceof Error ? error.message : String(error),
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
