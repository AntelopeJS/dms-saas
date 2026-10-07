import type {
  ActivityFeedItem,
  KeyValueListItem,
  StatGroupItem,
} from "@antelopejs/interface-dms/base";
import type { UpcomingInvoicePreview } from "@antelopejs/interface-dms-saas/billing";
import type { PaymentMethodSummary } from "../billing-state/recovery";
import type { Invoice, TenantBillingInfo } from "../db";
import type { ServerMessages } from "../i18n/server-messages";
import { monthlyAmountAfterTrial } from "../metrics/directory-summary";
import { stripeDashboardUrl } from "../stripe/dashboard-links";
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
const SEPARATOR = " · ";
const MONTH_YEAR_FORMAT: Intl.DateTimeFormatOptions = {
  month: "short",
  year: "numeric",
};

function priceTimesSeats(
  messages: ServerMessages,
  view: WorkspaceOperatorView,
): string {
  const { directory } = view;
  const price = messages.money(
    directory.planUnitAmountMinor ?? 0,
    directory.currency ?? "",
  );
  const interval = messages.t(
    `saas.workspaces.interval.${directory.planInterval ?? "month"}`,
  );
  return directory.planBillingMode === "seat"
    ? messages.t(`${D}.facts.price_times_seats`, {
        price,
        seats: directory.seats,
        interval,
      })
    : messages.t(`${D}.facts.flat_price`, { price, interval });
}

/** Why a workspace pays nothing, or how its MRR is made up. */
function mrrDetail(
  messages: ServerMessages,
  view: WorkspaceOperatorView,
): string {
  const { directory, billingState } = view;
  if (!directory.planName) return messages.t(`${D}.facts.no_plan`);
  if (directory.isComplimentary) return messages.t(`${D}.facts.complimentary`);
  if (billingState === "trialing") {
    const then = monthlyAmountAfterTrial(view.directory);
    return messages.t(`${D}.facts.trial_then`, {
      amount: messages.money(then.amountMinor, then.currency),
    });
  }
  if (billingState === "suspended")
    return messages.t(`${D}.facts.billing_paused`);
  return priceTimesSeats(messages, view);
}

function mrrFact(
  messages: ServerMessages,
  view: WorkspaceOperatorView,
): StatGroupItem {
  const { directory } = view;
  return {
    id: "mrr",
    icon: "i-ph-currency-circle-dollar",
    eyebrow: `$${D}.facts.mrr`,
    value: directory.currency
      ? messages.money(directory.mrrMinor, directory.currency)
      : "—",
    detail: mrrDetail(messages, view),
    detailTone: view.billingState === "past_due" ? "error" : undefined,
  };
}

function seatsFact(
  messages: ServerMessages,
  view: WorkspaceOperatorView,
): StatGroupItem {
  const maxMembers = view.plan?.maxMembers ?? UNLIMITED_MEMBERS;
  const used = view.seats.occupied;
  return {
    id: "seats",
    icon: "i-ph-users",
    eyebrow: `$${D}.facts.seats`,
    value:
      maxMembers === UNLIMITED_MEMBERS
        ? String(used)
        : messages.t(`${D}.facts.seats_of`, { used, max: maxMembers }),
    detail: messages.t(`${D}.facts.pending_invitations`, {
      count: view.seats.pendingInvites,
    }),
  };
}

function nextInvoiceFact(
  messages: ServerMessages,
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
    return { ...base, value: "—", detail: messages.t(`${D}.facts.${reason}`) };
  }
  return {
    ...base,
    value: messages.day(new Date(preview.billingDate)),
    detail: messages.t(`${D}.facts.next_invoice_total`, {
      amount: messages.money(preview.totalMinorUnits, preview.currency),
    }),
  };
}

function stripeFact(
  messages: ServerMessages,
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
      value: "—",
      detail: messages.t(`${D}.facts.no_stripe_customer`),
    };
  const cardLabel = card
    ? `${SEPARATOR}${messages.t(`${D}.facts.card`, { brand: card.brand, last4: card.last4 })}`
    : "";
  return {
    ...base,
    value: customerId,
    detail: `${messages.t(`${D}.facts.open_in_stripe`)}${cardLabel}`,
    to: stripeDashboardUrl("customers", customerId),
  };
}

function lifetimeFact(
  messages: ServerMessages,
  invoices: Invoice[],
): StatGroupItem {
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
    value: currency ? messages.money(totalMinor, currency) : "—",
    detail: first
      ? messages.t(`${D}.facts.lifetime_detail`, {
          count: paid.length,
          since: new Intl.DateTimeFormat(
            messages.locale,
            MONTH_YEAR_FORMAT,
          ).format(first),
        })
      : messages.t(`${D}.facts.no_paid_invoice`),
  };
}

/** The facts strip: MRR, seats, next invoice, Stripe customer, lifetime revenue. */
export function workspaceFacts(
  messages: ServerMessages,
  inputs: WorkspaceFactsInputs,
): StatGroupItem[] {
  return [
    mrrFact(messages, inputs.view),
    seatsFact(messages, inputs.view),
    nextInvoiceFact(messages, inputs.preview),
    stripeFact(messages, inputs.view, inputs.card),
    lifetimeFact(
      messages,
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
        meta: [priceTimesSeats(messages, view)],
        date: preview.billingDate,
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
    },
  ];
}

/** Whether a document is an invoice (the mirror also holds credit notes). */
export function isInvoiceDocument(document: Invoice): boolean {
  return document.documentType === INVOICE_DOCUMENT;
}
