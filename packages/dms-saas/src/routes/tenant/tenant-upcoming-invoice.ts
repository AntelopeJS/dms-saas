// The "Next invoice" card of the billing page: Stripe's preview of the next
// invoice, as the rows of a DMS KeyValueList block.

import {
  Context,
  Controller,
  Get,
  HTTPResult,
  type RequestContext,
} from "@antelopejs/interface-api";
import { GetModel } from "@antelopejs/interface-database-decorators";
import type {
  AvailableUpcomingInvoicePreview,
  UpcomingInvoiceLine,
  UpcomingInvoiceTax,
} from "@antelopejs/interface-dms-saas/billing";
import type {
  ComposedText,
  KeyValueListItem,
} from "@antelopejs/interface-dms/base";
import { AuthUserWithPermission } from "@antelopejs/interface-dms/guards";
import { getRequestTenantId } from "@antelopejs/interface-dms/request-tenant";
import type { User } from "@antelopejs/interface-dms/auth/db";
import {
  fetchDefaultPaymentMethod,
  type PaymentMethodSummary,
} from "../../billing-state";
import {
  type Invoice,
  InvoiceModel,
  TenantBillingInfoModel,
  TenantSubscriptionModel,
} from "../../db";
import { SaasTenantBillingController as BillingPage } from "../../pages/tenant/billing";
import {
  composed,
  dateParam,
  dotList,
  valueText,
} from "../../i18n/composed-text";
import { getUpcomingInvoicePreview } from "../../upcoming-invoice/preview";

const HTTP_SERVICE_UNAVAILABLE = 503;
const MINOR_UNITS_PER_MAJOR = 100;
const PAID_STATUS = "paid";
const KEY_PREFIX = "$saas.tenant_billing.next_invoice";
const PERCENT = 100;
const MASKED_DIGITS = "••••";
const PAID_ON_KEY = "saas.tenant_billing.next_invoice.paid_on";

/**
 * The rows of the card, plus the figures the trial notice reads. An empty
 * list is a workspace with nothing to invoice (free, gifted, not on Stripe).
 */
export interface NextInvoiceRows {
  items: KeyValueListItem[];
  totalMinorUnits: number | null;
  currency: string | null;
  billingDate: string | null;
}

/** What the rows are written from besides the preview itself. */
interface NextInvoiceContext {
  paymentMethod: PaymentMethodSummary | null;
  billingEmail: string | null;
  lastPayment: Invoice | null;
}

const NOTHING_TO_INVOICE: NextInvoiceRows = {
  items: [],
  totalMinorUnits: null,
  currency: null,
  billingDate: null,
};

function fullDay(
  value: string | Date | null | undefined,
): ComposedText | undefined {
  return value ? valueText(dateParam(value)) : undefined;
}

// The list draws no pill beside an amount: the state reads in the detail.
function paidOn(paidAt: Date | null | undefined): ComposedText | undefined {
  return paidAt
    ? composed(PAID_ON_KEY, { date: dateParam(paidAt) })
    : undefined;
}

function fromMinorUnits(amount: number): number {
  return amount / MINOR_UNITS_PER_MAJOR;
}

function lineRow(
  line: UpcomingInvoiceLine,
  currency: string,
): KeyValueListItem {
  const period = composed("saas.text.range", {
    from: dateParam(line.periodStart, "day"),
    to: dateParam(line.periodEnd, "day"),
  });
  return {
    label: line.description ?? `${KEY_PREFIX}.line`,
    value: fromMinorUnits(line.amountMinorUnits),
    type: "money",
    currency,
    detail: period,
  };
}

function taxDetail(tax: UpcomingInvoiceTax): ComposedText | undefined {
  const rate =
    tax.ratePercentage === null
      ? []
      : [
          {
            type: "number" as const,
            value: tax.ratePercentage / PERCENT,
            format: "percent" as const,
          },
        ];
  return dotList([...rate, ...(tax.country ? [tax.country] : [])]) ?? undefined;
}

function taxRow(tax: UpcomingInvoiceTax, currency: string): KeyValueListItem {
  return {
    label: tax.isReverseCharge
      ? `${KEY_PREFIX}.reverse_charge`
      : `${KEY_PREFIX}.tax`,
    value: fromMinorUnits(tax.amountMinorUnits),
    type: "money",
    currency,
    detail: taxDetail(tax),
  };
}

function cardLabel(card: PaymentMethodSummary): string {
  const brand = card.brand.charAt(0).toUpperCase() + card.brand.slice(1);
  return `${brand} ${MASKED_DIGITS} ${card.last4}`;
}

function contextRows(context: NextInvoiceContext): KeyValueListItem[] {
  const { paymentMethod, billingEmail, lastPayment } = context;
  const rows: KeyValueListItem[] = [];
  if (paymentMethod) {
    rows.push({
      label: `${KEY_PREFIX}.charged_to`,
      value: cardLabel(paymentMethod),
    });
  }
  if (billingEmail) {
    rows.push({ label: `${KEY_PREFIX}.sent_to`, value: billingEmail });
  }
  if (lastPayment) {
    rows.push({
      label: `${KEY_PREFIX}.last_payment`,
      value: fromMinorUnits(lastPayment.total || lastPayment.amount),
      type: "money",
      currency: lastPayment.currency.toUpperCase(),
      detail: paidOn(lastPayment.paidAt),
    });
  }
  return rows;
}

/**
 * The preview as label / value rows: each line excluding tax, each tax with
 * its rate and country, the total due on the billing date, then how and to
 * whom the invoice goes.
 */
export function toNextInvoiceRows(
  preview: AvailableUpcomingInvoicePreview,
  context: NextInvoiceContext,
): NextInvoiceRows {
  const { currency } = preview;
  const total: KeyValueListItem = {
    label: `${KEY_PREFIX}.total`,
    value: fromMinorUnits(preview.amountDueMinorUnits),
    type: "money",
    currency,
    tone: "primary",
    detail: fullDay(preview.billingDate),
  };
  return {
    items: [
      ...preview.lines.map((line) => lineRow(line, currency)),
      ...preview.taxes.map((tax) => taxRow(tax, currency)),
      total,
      ...contextRows(context),
    ],
    totalMinorUnits: preview.amountDueMinorUnits,
    currency,
    billingDate: preview.billingDate,
  };
}

/** The most recent invoice the customer paid. */
export function latestPaidInvoice(invoices: Invoice[]): Invoice | null {
  return invoices
    .filter((invoice) => invoice.status === PAID_STATUS && invoice.paidAt)
    .reduce<Invoice | null>(
      (latest, invoice) =>
        !latest ||
        new Date(invoice.paidAt as Date) > new Date(latest.paidAt as Date)
          ? invoice
          : latest,
      null,
    );
}

async function loadContext(tenantId: string): Promise<NextInvoiceContext> {
  const [subscription, billingInfo, invoices] = await Promise.all([
    GetModel(TenantSubscriptionModel, tenantId).findOne(),
    GetModel(TenantBillingInfoModel, tenantId).findOne(),
    GetModel(InvoiceModel, tenantId).getAllInvoices(),
  ]);
  const paymentMethod = subscription?.stripeCustomerId
    ? await fetchDefaultPaymentMethod(subscription.stripeCustomerId)
    : null;
  return {
    paymentMethod,
    billingEmail: billingInfo?.billingEmail ?? null,
    lastPayment: latestPaidInvoice(invoices),
  };
}

// Read from the billing page, which stays reachable under the tenant access
// gate; whoever may see the card may read it, as the roles editor grants.
export class SaasTenantUpcomingInvoiceController extends Controller(
  "/api/saas/tenant/upcoming-invoice",
) {
  @Get("/")
  async getNextInvoice(
    @AuthUserWithPermission(BillingPage.nextInvoice, {
      bypassTenantAccessGate: true,
    })
    _user: User,
    @Context() ctx: RequestContext,
  ): Promise<NextInvoiceRows> {
    const tenantId = getRequestTenantId(ctx);
    const preview = await getUpcomingInvoicePreview(tenantId);
    if (preview.status === "absent") return NOTHING_TO_INVOICE;
    if (preview.status === "unavailable") {
      throw new HTTPResult(
        HTTP_SERVICE_UNAVAILABLE,
        "saas.errors.billing.preview_unavailable",
      );
    }
    const context = await loadContext(tenantId);
    return toNextInvoiceRows(preview, context);
  }
}
