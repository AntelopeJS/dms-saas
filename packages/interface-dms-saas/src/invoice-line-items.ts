import { RegisteringProxy } from "@antelopejs/interface-core";

/**
 * A single usage line a provider wants on the renewal invoice.
 *
 * `amountCents` is the total for the line in the invoice currency, as an
 * integer number of cents. It may be negative: a plan's included credit is
 * expressed as a negative line that reduces the invoice's amount due.
 *
 * `key` identifies the metric within the provider and is the unit of
 * idempotency: the same `key` is never injected twice on the same invoice,
 * however many times the Stripe webhook is replayed. Keep it stable across
 * cycles (`vcpu-minutes`, `egress-bytes`) — never derive it from a timestamp.
 *
 * `quantity` and `unit` are recorded as Stripe metadata for auditability;
 * the amount charged is always `amountCents`, never a re-multiplication.
 */
export interface InvoiceLineItem {
  key: string;
  description: string;
  amountCents: number;
  quantity?: number;
  unit?: string;
  metadata?: Record<string, string>;
}

/**
 * The billing window a resolver is asked to bill for.
 *
 * `periodStart` / `periodEnd` are the boundaries of the cycle that just
 * closed, taken from the Stripe invoice's usage period — not the upcoming
 * cycle the plan line covers.
 * For workspaces with paid usage coverage, these boundaries are clipped to
 * the invoiced subscription's paid period. Complimentary and grace usage is
 * excluded; providers are not invoked for an empty covered window.
 *
 * `isPreview` is set when dms-saas prices the upcoming invoice rather than
 * billing a closed cycle: `periodEnd` is then the time of the request, the
 * lines are only quoted to Stripe and never invoiced, and `invoiceId` is a
 * synthetic `upcoming_` identifier that names no Stripe invoice.
 */
export interface InvoiceLineItemsContext {
  tenantId: string;
  invoiceId: string;
  currency: string;
  periodStart: Date;
  periodEnd: Date;
  isPreview?: boolean;
}

export type InvoiceLineItemsResolver = (
  context: InvoiceLineItemsContext,
) => Promise<InvoiceLineItem[]> | InvoiceLineItem[];

export interface InvoiceLineItemsProvider {
  id: string;
  resolve: InvoiceLineItemsResolver;
}

export const LINE_KEY_SEPARATOR = ":";
const MAX_LINE_KEY_LENGTH = 150;

export type SkippedLineItemReason =
  | "already_invoiced"
  | "duplicate_key"
  | "zero_amount"
  | "invalid";

export interface PreparedInvoiceLineItem {
  lineKey: string;
  item: InvoiceLineItem;
}

export interface SkippedInvoiceLineItem {
  lineKey: string;
  reason: SkippedLineItemReason;
}

export interface InvoiceLineItemSelection {
  accepted: PreparedInvoiceLineItem[];
  skipped: SkippedInvoiceLineItem[];
}

interface RejectionRule {
  reason: SkippedLineItemReason;
  isViolated: (item: InvoiceLineItem) => boolean;
}

function isFilledString(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

const REJECTION_RULES: readonly RejectionRule[] = [
  { reason: "invalid", isViolated: (item) => !isFilledString(item.key) },
  {
    reason: "invalid",
    isViolated: (item) => item.key.includes(LINE_KEY_SEPARATOR),
  },
  {
    reason: "invalid",
    isViolated: (item) => !isFilledString(item.description),
  },
  {
    reason: "invalid",
    isViolated: (item) => !Number.isSafeInteger(item.amountCents),
  },
  { reason: "zero_amount", isViolated: (item) => item.amountCents === 0 },
];

export function buildInvoiceLineKey(providerId: string, key: string): string {
  return `${providerId}${LINE_KEY_SEPARATOR}${key}`;
}

function toLineKeyFragment(key: unknown): string {
  return typeof key === "string" ? key.trim() : String(key);
}

function findRejectionReason(
  item: InvoiceLineItem,
): SkippedLineItemReason | null {
  return REJECTION_RULES.find((rule) => rule.isViolated(item))?.reason ?? null;
}

function findOversizedKeyRejection(
  lineKey: string,
): SkippedLineItemReason | null {
  return lineKey.length > MAX_LINE_KEY_LENGTH ? "invalid" : null;
}

function resolveDuplicateReason(
  lineKey: string,
  alreadyInjectedKeys: ReadonlySet<string>,
  selectedKeys: ReadonlySet<string>,
): SkippedLineItemReason | null {
  if (alreadyInjectedKeys.has(lineKey)) return "already_invoiced";
  if (selectedKeys.has(lineKey)) return "duplicate_key";
  return null;
}

/**
 * Turn one provider's returned lines into the set of Stripe invoice items to
 * create, dropping everything that must not reach Stripe: lines already
 * injected on this invoice by a previous delivery of the webhook, keys the
 * provider returned twice in the same batch, zero amounts, and structurally
 * unusable lines. Returns the rejections so the caller can report them.
 */
export function selectInvoiceLineItemsToCreate(
  providerId: string,
  items: readonly InvoiceLineItem[],
  alreadyInjectedKeys: ReadonlySet<string>,
): InvoiceLineItemSelection {
  const accepted: PreparedInvoiceLineItem[] = [];
  const skipped: SkippedInvoiceLineItem[] = [];
  const selectedKeys = new Set<string>();

  for (const item of items) {
    const lineKey = buildInvoiceLineKey(
      providerId,
      toLineKeyFragment(item.key),
    );
    const rejection =
      findRejectionReason(item) ?? findOversizedKeyRejection(lineKey);
    if (rejection) {
      skipped.push({ lineKey, reason: rejection });
      continue;
    }
    const duplicate = resolveDuplicateReason(
      lineKey,
      alreadyInjectedKeys,
      selectedKeys,
    );
    if (duplicate) {
      skipped.push({ lineKey, reason: duplicate });
      continue;
    }
    selectedKeys.add(lineKey);
    accepted.push({ lineKey, item: { ...item, key: item.key.trim() } });
  }

  return { accepted, skipped };
}

export namespace internal {
  export const RegisterInvoiceLineItemsProvider = new RegisteringProxy<
    (providerId: string, resolve: InvoiceLineItemsResolver) => void
  >();
}

/**
 * Register a provider of invoice line items.
 *
 * dms-saas calls every registered provider when Stripe creates a cycle
 * renewal invoice, while that invoice is still a draft, and pushes whatever
 * they return as Stripe invoice items before finalization. dms-saas never
 * interprets the lines: what a metric is, how it is measured and how it is
 * priced belong entirely to the provider.
 *
 * Semantics:
 * - Providers run in registration order; one that throws is logged and
 *   skipped, leaving the other providers and the invoice mirror untouched.
 * - Injection is idempotent per (invoice, provider, line key): a replayed
 *   webhook, a redelivery or a concurrent worker never duplicates a line.
 * - `id` namespaces the line keys, so two providers may use the same metric
 *   name. Neither `id` nor a line key may contain `:`, which joins them.
 * - An `id` must be unique across modules. Registering one that is already
 *   taken replaces the previous provider, whose usage lines then stop being
 *   invoiced. The clash is reported at error level only once dms-saas is
 *   attached: earlier registrations are held in a buffer keyed by `id`, so the
 *   replaced one is already gone by the time dms-saas sees anything.
 * - Resolvers run inside the Stripe webhook request: read pre-aggregated
 *   rollups rather than computing usage on the fly.
 * - The registration is held until dms-saas attaches, replayed when dms-saas
 *   is reloaded, and dropped when the registering module is unloaded.
 * - Call during your module's `construct()`, and call
 *   `UnregisterInvoiceLineItemsProvider` in its `stop()`.
 */
export function RegisterInvoiceLineItemsProvider(
  provider: InvoiceLineItemsProvider,
): void {
  if (provider.id.includes(LINE_KEY_SEPARATOR)) {
    throw new Error(
      `An invoice line items provider id cannot contain '${LINE_KEY_SEPARATOR}' (got '${provider.id}').`,
    );
  }
  internal.RegisterInvoiceLineItemsProvider.register(
    provider.id,
    provider.resolve,
  );
}

/**
 * Remove a previously registered provider. Unknown ids are ignored.
 */
export function UnregisterInvoiceLineItemsProvider(providerId: string): void {
  internal.RegisterInvoiceLineItemsProvider.unregister(providerId);
}
