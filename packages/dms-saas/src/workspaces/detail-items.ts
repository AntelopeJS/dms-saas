import type {
  ActivityFeedItem,
  ComposedText,
  KeyValueListItem,
  StatGroupItem,
} from "@antelopejs/interface-dms/base";
import type { UpcomingInvoicePreview } from "@antelopejs/interface-dms-saas/billing";
import type { PaymentMethodSummary } from "../billing-state/recovery";
import type { Invoice, TenantBillingInfo } from "../db";
import {
  composed,
  countParam,
  dateParam,
  dotList,
  moneyParam,
  valueText,
} from "../i18n/composed-text";
import type { ServerMessages } from "../i18n/server-messages";
import { monthlyAmountAfterTrial } from "../metrics/directory-summary";
import { stripeObjectUrl } from "../stripe/dashboard-links";
import type { WorkspaceOperatorView } from "./operator-view";

/** What the facts strip of a workspace is built from, besides the view. */
export interface WorkspaceFactsInputs {
  view: WorkspaceOperatorView;
  preview: UpcomingInvoicePreview | null;
  card: PaymentMethodSummary | null;
  invoices: Invoice[];
}

const D = "saas.workspace_detail";
const UNLIMITED_MEMBERS = -1;
const PAID_STATUS = "paid";
const INVOICE_DOCUMENT = "invoice";
const NO_VALUE = "—";

function priceTimesSeats(view: WorkspaceOperatorView): ComposedText {
  const { directory } = view;
  const price = moneyParam(
    directory.planUnitAmountMinor ?? 0,
    directory.currency ?? "",
  );
  const interval = composed(
    `saas.workspaces.interval.${directory.planInterval ?? "month"}`,
  );
  return directory.planBillingMode === "seat"
    ? composed(`${D}.facts.price_times_seats`, {
        price,
        seats: directory.seats,
        interval,
      })
    : composed(`${D}.facts.flat_price`, { price, interval });
}

/** Why a workspace pays nothing, or how its MRR is made up. */
function mrrDetail(view: WorkspaceOperatorView): ComposedText {
  const { directory, billingState } = view;
  if (!directory.planName) return composed(`${D}.facts.no_plan`);
  if (directory.isComplimentary) return composed(`${D}.facts.complimentary`);
  if (billingState === "trialing") {
    const then = monthlyAmountAfterTrial(view.directory);
    return composed(`${D}.facts.trial_then`, {
      amount: moneyParam(then.amountMinor, then.currency),
    });
  }
  if (billingState === "suspended")
    return composed(`${D}.facts.billing_paused`);
  return priceTimesSeats(view);
}

function mrrFact(view: WorkspaceOperatorView): StatGroupItem {
  const { directory } = view;
  return {
    id: "mrr",
    icon: "i-ph-currency-circle-dollar",
    eyebrow: `$${D}.facts.mrr`,
    value: directory.currency
      ? valueText(moneyParam(directory.mrrMinor, directory.currency))
      : NO_VALUE,
    detail: mrrDetail(view),
    detailTone: view.billingState === "past_due" ? "error" : undefined,
  };
}

function seatsFact(view: WorkspaceOperatorView): StatGroupItem {
  const maxMembers = view.plan?.maxMembers ?? UNLIMITED_MEMBERS;
  const used = view.seats.occupied;
  return {
    id: "seats",
    icon: "i-ph-users",
    eyebrow: `$${D}.facts.seats`,
    value:
      maxMembers === UNLIMITED_MEMBERS
        ? used
        : composed(`${D}.facts.seats_of`, { used, max: maxMembers }),
    detail: composed(`${D}.facts.pending_invitations`, {
      count: countParam(view.seats.pendingInvites),
    }),
  };
}

function nextInvoiceFact(
  preview: UpcomingInvoicePreview | null,
): StatGroupItem {
  const base = {
    id: "next_invoice",
    icon: "i-ph-calendar-blank",
    eyebrow: `$${D}.facts.next_invoice`,
  };
  if (preview?.status !== "available") {
    const reason =
      preview?.status === "absent" ? "nothing_billed" : "preview_unavailable";
    return { ...base, value: NO_VALUE, detail: `$${D}.facts.${reason}` };
  }
  return {
    ...base,
    value: valueText(dateParam(preview.billingDate, "day")),
    detail: composed(`${D}.facts.next_invoice_total`, {
      amount: moneyParam(preview.totalMinorUnits, preview.currency),
    }),
  };
}

function stripeFact(
  view: WorkspaceOperatorView,
  card: PaymentMethodSummary | null,
): StatGroupItem {
  const customerId = view.subscription?.stripeCustomerId;
  const base = {
    id: "stripe",
    icon: "i-ph-stripe-logo",
    eyebrow: `$${D}.facts.stripe_customer`,
  };
  if (!customerId)
    return {
      ...base,
      value: NO_VALUE,
      detail: `$${D}.facts.no_stripe_customer`,
    };
  const open = composed(`${D}.facts.open_in_stripe`);
  return {
    ...base,
    value: customerId,
    detail: card
      ? dotList([
          open,
          composed(`${D}.facts.card`, { brand: card.brand, last4: card.last4 }),
        ])!
      : open,
    to: stripeObjectUrl("customers", customerId),
  };
}

function lifetimeFact(invoices: Invoice[]): StatGroupItem {
  const paid = invoices.filter(
    (invoice) =>
      invoice.status === PAID_STATUS && invoice.documentType !== "credit_note",
  );
  const currency = paid[0]?.currency ?? "";
  const totalMinor = paid
    .filter((invoice) => invoice.currency === currency)
    .reduce((sum, invoice) => sum + (invoice.total || invoice.amount), 0);
  const first = paid
    .map((invoice) => new Date(invoice.issuedAt))
    .sort((left, right) => left.getTime() - right.getTime())[0];
  return {
    id: "lifetime",
    icon: "i-ph-chart-line-up",
    eyebrow: `$${D}.facts.lifetime_revenue`,
    value: currency ? valueText(moneyParam(totalMinor, currency)) : NO_VALUE,
    detail: first
      ? composed(`${D}.facts.lifetime_detail`, {
          count: countParam(paid.length),
          since: dateParam(first),
        })
      : `$${D}.facts.no_paid_invoice`,
  };
}

/** The facts strip: MRR, seats, next invoice, Stripe customer, lifetime revenue. */
export function workspaceFacts(inputs: WorkspaceFactsInputs): StatGroupItem[] {
  return [
    mrrFact(inputs.view),
    seatsFact(inputs.view),
    nextInvoiceFact(inputs.preview),
    stripeFact(inputs.view, inputs.card),
    lifetimeFact(
      inputs.invoices.filter(
        (invoice) => invoice.documentType !== "credit_note",
      ),
    ),
  ];
}

function addressLine(info: TenantBillingInfo): string | null {
  const address = info.address;
  if (!address) return null;
  const parts = [
    address.line1,
    address.line2,
    [address.postalCode, address.city].filter(Boolean).join(" "),
    address.country,
  ].filter((part): part is string => !!part);
  return parts.length > 0 ? parts.join(", ") : null;
}

/** The billing identity, as label / value rows; none when nothing is filled in. */
export function billingInfoItems(
  info: TenantBillingInfo | undefined,
): KeyValueListItem[] {
  if (!info) return [];
  const rows: KeyValueListItem[] = [
    {
      id: "customer_type",
      label: `$${D}.billing.customer_type`,
      value: info.customerType
        ? `$${D}.billing.customer_types.${info.customerType}`
        : null,
    },
    {
      id: "company",
      label: `$${D}.billing.company_name`,
      value: info.companyName,
    },
    {
      id: "vat",
      label: `$${D}.billing.vat_number`,
      value: info.vatNumber,
      type: "mono",
      detail: info.vatVerificationStatus
        ? `$${D}.billing.vat_status.${info.vatVerificationStatus}`
        : undefined,
    },
    {
      id: "email",
      label: `$${D}.billing.billing_email`,
      value: info.billingEmail,
    },
    { id: "address", label: `$${D}.billing.address`, value: addressLine(info) },
  ];
  return rows.filter(
    (row) => row.value !== null && row.value !== undefined && row.value !== "",
  );
}

/** The coming milestone of the subscription, first on its timeline. */
export function upcomingTimelineItems(
  messages: ServerMessages,
  view: WorkspaceOperatorView,
  preview: UpcomingInvoicePreview | null,
): ActivityFeedItem[] {
  if (preview?.status === "available") {
    return [
      {
        id: "next_invoice",
        icon: "i-ph-calendar-blank",
        tone: "primary",
        title: `$${D}.timeline.next_invoice`,
        params: {
          amount: messages.money(preview.totalMinorUnits, preview.currency),
        },
        meta: [messages.compose(priceTimesSeats(view))],
        date: preview.billingDate,
        // A coming date reads as the day, not as a time relative to now.
        time: messages.day(new Date(preview.billingDate)),
      },
    ];
  }
  const { renewalKind, renewsAt } = view.directory;
  if (!renewalKind || !renewsAt || renewsAt.getTime() < Date.now()) return [];
  return [
    {
      id: "milestone",
      icon: "i-ph-flag",
      tone: "info",
      title: `$${D}.timeline.${renewalKind}`,
      date: renewsAt.toISOString(),
      time: messages.day(renewsAt),
    },
  ];
}

/** Whether a document is an invoice (the mirror also holds credit notes). */
export function isInvoiceDocument(document: Invoice): boolean {
  return document.documentType === INVOICE_DOCUMENT;
}
