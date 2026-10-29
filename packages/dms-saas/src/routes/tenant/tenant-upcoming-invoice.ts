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
  type Plan,
  PlanModel,
  TenantBillingInfoModel,
  type TenantSubscription,
  TenantSubscriptionModel,
} from "../../db";
import { isFreePlan } from "../../workspaces/free-plan";
import { nextInvoice } from "../../pages/tenant/billing";
import {
  composed,
  dateParam,
  dotList,
  valueText,
} from "../../i18n/composed-text";
import { getUpcomingInvoicePreview } from "../../upcoming-invoice/preview";
import { fromMinorUnits } from "../../utils/money";

const HTTP_SERVICE_UNAVAILABLE = 503;
const PAID_STATUS = "paid";
const KEY_PREFIX = "$saas.tenant_billing.next_invoice";
const PERCENT = 100;
const MASKED_DIGITS = "••••";
const PAID_ON_KEY = "saas.tenant_billing.next_invoice.paid_on";
const SUBSCRIPTION_LINE_KEY =
  "saas.tenant_billing.next_invoice.subscription_line";
const PAID_UNTIL_KEY = "saas.tenant_billing.next_invoice.paid_until";
const SWITCH_ON_KEY = "saas.tenant_billing.next_invoice.switch_on";
const SWITCH_FREE_DETAIL_KEY =
  "saas.tenant_billing.next_invoice.switch_free_detail";

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

/** A plan change scheduled for the renewal, as the card announces it. */
export interface PlanSwitch {
  currentPlanName: string;
  nextPlanName: string;
  isNextPlanFree: boolean;
  at: Date;
}

/** What the rows are written from besides the preview itself. */
interface NextInvoiceContext {
  paymentMethod: PaymentMethodSummary | null;
  billingEmail: string | null;
  lastPayment: Invoice | null;
  /** Plan names by Stripe product, to word the plan's own line. */
  planNames: ReadonlyMap<string, string>;
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

/** The list draws no pill beside an amount: the state reads in the detail. */
function paidOn(paidAt: Date | null | undefined): ComposedText | undefined {
  return paidAt
    ? composed(PAID_ON_KEY, { date: dateParam(paidAt) })
    : undefined;
}

/**
 * The line's label. Stripe words a plan's recurring line in the account's
 * language whatever the customer's ("1 × Pro (at €29.00 / month)"), so it is
 * written here in the reader's; other lines (prorations, usage) keep Stripe's
 * or their provider's wording.
 */
function lineLabel(
  line: UpcomingInvoiceLine,
  planNames: ReadonlyMap<string, string>,
): KeyValueListItem["label"] {
  const planName = line.productId ? planNames.get(line.productId) : undefined;
  if (line.kind === "subscription" && !line.isProration && planName) {
    return composed(SUBSCRIPTION_LINE_KEY, {
      quantity: { type: "number", value: line.quantity ?? 1 },
      plan: planName,
    });
  }
  return line.description ?? `${KEY_PREFIX}.line`;
}

function lineRow(
  line: UpcomingInvoiceLine,
  currency: string,
  planNames: ReadonlyMap<string, string>,
): KeyValueListItem {
  const period = composed("saas.text.range", {
    from: dateParam(line.periodStart, "day"),
    to: dateParam(line.periodEnd, "day"),
  });
  return {
    label: lineLabel(line, planNames),
    value: fromMinorUnits(line.amountMinorUnits, currency),
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
    value: fromMinorUnits(tax.amountMinorUnits, currency),
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
      value: fromMinorUnits(lastPayment.total, lastPayment.currency),
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
    value: fromMinorUnits(preview.amountDueMinorUnits, currency),
    type: "money",
    currency,
    tone: "primary",
    detail: fullDay(preview.billingDate),
  };
  return {
    items: [
      ...preview.lines.map((line) =>
        lineRow(line, currency, context.planNames),
      ),
      ...preview.taxes.map((tax) => taxRow(tax, currency)),
      total,
      ...contextRows(context),
    ],
    totalMinorUnits: preview.amountDueMinorUnits,
    currency,
    billingDate: preview.billingDate,
  };
}

function switchRow(planSwitch: PlanSwitch): KeyValueListItem {
  const plan = planSwitch.nextPlanName;
  return {
    label: composed(SWITCH_ON_KEY, { plan }),
    value: planSwitch.at.toISOString(),
    type: "date",
    tone: "warning",
    detail: planSwitch.isNextPlanFree
      ? composed(SWITCH_FREE_DETAIL_KEY, { plan })
      : undefined,
  };
}

/**
 * The card of a workspace whose plan changes at the renewal. Stripe prices no
 * renewal for a paid plan that ends on a free one, so the card says until
 * when the current plan is paid instead of claiming nothing is running; a
 * priced invoice keeps its rows, with the switch after its total.
 */
export function withPlanSwitch(
  rows: NextInvoiceRows,
  planSwitch: PlanSwitch,
  context: NextInvoiceContext,
): NextInvoiceRows {
  if (rows.items.length > 0) {
    const contextStart = rows.items.findIndex(
      (row) => row.label === `${KEY_PREFIX}.total`,
    );
    const at = contextStart < 0 ? rows.items.length : contextStart + 1;
    return {
      ...rows,
      items: [
        ...rows.items.slice(0, at),
        switchRow(planSwitch),
        ...rows.items.slice(at),
      ],
    };
  }
  const at = planSwitch.at.toISOString();
  return {
    items: [
      {
        label: composed(PAID_UNTIL_KEY, { plan: planSwitch.currentPlanName }),
        value: at,
        type: "date",
      },
      switchRow(planSwitch),
      ...contextRows(context),
    ],
    totalMinorUnits: null,
    currency: null,
    billingDate: at,
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

/** Plan names by Stripe product, retired plans included: a line may still bill one. */
export function planNamesByProduct(plans: Plan[]): Map<string, string> {
  return new Map(
    plans.flatMap((plan) => {
      const productId = plan.paymentProviderRefs?.stripeProductId;
      return productId ? [[productId, plan.name] as const] : [];
    }),
  );
}

interface LoadedContext {
  context: NextInvoiceContext;
  planSwitch: PlanSwitch | null;
}

function scheduledSwitch(
  subscription: TenantSubscription | undefined,
  plans: Plan[],
): PlanSwitch | null {
  const { planId, pendingPlanId, pendingPlanChangeAt } = subscription ?? {};
  if (!pendingPlanId || !pendingPlanChangeAt) return null;
  const current = plans.find((plan) => plan._id === planId);
  const next = plans.find((plan) => plan._id === pendingPlanId);
  if (!current || !next) return null;
  return {
    currentPlanName: current.name,
    nextPlanName: next.name,
    isNextPlanFree: isFreePlan(next),
    at: new Date(pendingPlanChangeAt),
  };
}

async function loadContext(tenantId: string): Promise<LoadedContext> {
  const [subscription, billingInfo, invoices, plans] = await Promise.all([
    GetModel(TenantSubscriptionModel, tenantId).findOne(),
    GetModel(TenantBillingInfoModel, tenantId).findOne(),
    GetModel(InvoiceModel, tenantId).getAllInvoices(),
    GetModel(PlanModel).findNotDeleted(),
  ]);
  const paymentMethod = subscription?.stripeCustomerId
    ? await fetchDefaultPaymentMethod(subscription.stripeCustomerId)
    : null;
  return {
    context: {
      paymentMethod,
      billingEmail: billingInfo?.billingEmail ?? null,
      lastPayment: latestPaidInvoice(invoices),
      planNames: planNamesByProduct(plans),
    },
    planSwitch: scheduledSwitch(subscription, plans),
  };
}

/**
 * The "Next invoice" card of the billing page: Stripe's preview of the next
 * invoice, as the rows of a DMS KeyValueList block. Read from the billing
 * page, which stays reachable under the tenant access gate; whoever may see
 * the card may read it, as the roles editor grants.
 */
export class SaasTenantUpcomingInvoiceController extends Controller(
  "/api/saas/tenant/upcoming-invoice",
) {
  @Get("/")
  async getNextInvoice(
    @AuthUserWithPermission(nextInvoice, {
      bypassTenantAccessGate: true,
    })
    _user: User,
    @Context() ctx: RequestContext,
  ): Promise<NextInvoiceRows> {
    const tenantId = getRequestTenantId(ctx);
    const preview = await getUpcomingInvoicePreview(tenantId);
    if (preview.status === "unavailable") {
      throw new HTTPResult(
        HTTP_SERVICE_UNAVAILABLE,
        "saas.errors.billing.preview_unavailable",
      );
    }
    const { context, planSwitch } = await loadContext(tenantId);
    const rows =
      preview.status === "absent"
        ? NOTHING_TO_INVOICE
        : toNextInvoiceRows(preview, context);
    return planSwitch ? withPlanSwitch(rows, planSwitch, context) : rows;
  }
}
