import { PLAN_IDS } from "./catalogue";
import { WORKSPACE_IDS } from "./workspaces";
import type {
  DayOffset,
  SeedCreditNote,
  SeedInvoice,
  SeedInvoiceLine,
} from "./types";

const EUR = "eur";
const USD = "usd";
const FRENCH_VAT_RATE = 20;
const REVERSE_CHARGE_RATE = 0;
const BILLING_CYCLE_DAYS = 30;
const YEAR_DAYS = 365;

const W = WORKSPACE_IDS;
const P = PLAN_IDS;

interface RecurringInvoices {
  idPrefix: string;
  tenantId: string;
  planId: string;
  line: SeedInvoiceLine;
  taxRate: number;
  /** Start of the most recent period, the newest invoice of the series. */
  latestPeriodStartOn: DayOffset;
  count: number;
}

function periodInvoice(series: RecurringInvoices, index: number): SeedInvoice {
  const periodStartOn = series.latestPeriodStartOn - index * BILLING_CYCLE_DAYS;
  return {
    id: `${series.idPrefix}${String(index).padStart(2, "0")}`,
    tenantId: series.tenantId,
    planId: series.planId,
    status: "paid",
    currency: EUR,
    taxRate: series.taxRate,
    issuedOn: periodStartOn,
    periodStartOn,
    periodEndOn: periodStartOn + BILLING_CYCLE_DAYS,
    lines: [series.line],
  };
}

/** A paid monthly invoice per period, newest first. */
function paidMonthlyInvoices(series: RecurringInvoices): SeedInvoice[] {
  return Array.from({ length: series.count }, (_, index) =>
    periodInvoice(series, index),
  );
}

function seats(
  plan: string,
  quantity: number,
  unitAmount: number,
): SeedInvoiceLine {
  return { description: `${plan} × ${quantity} seats`, quantity, unitAmount };
}

function flat(plan: string, unitAmount: number): SeedInvoiceLine {
  return { description: `${plan} plan`, quantity: 1, unitAmount };
}

function special(invoice: Omit<SeedInvoice, "periodEndOn">): SeedInvoice {
  return {
    ...invoice,
    periodEndOn: invoice.periodStartOn + BILLING_CYCLE_DAYS,
  };
}

const NORTHWIND_SEATS = seats("Business", 6, 4900);
const INITECH_SEATS = seats("Business", 4, 4900);
const ACME_SEATS = seats("Business", 2, 4900);

export const INVOICES: SeedInvoice[] = [
  ...paidMonthlyInvoices({
    idPrefix: "in_1Q2m8LKZ4vTnR1",
    tenantId: W.northwind,
    planId: P.business,
    line: NORTHWIND_SEATS,
    taxRate: REVERSE_CHARGE_RATE,
    latestPeriodStartOn: -6,
    count: 12,
  }),
  ...paidMonthlyInvoices({
    idPrefix: "in_1Pk3RuKZ7WmHs2",
    tenantId: W.umbrella,
    planId: P.business,
    line: seats("Business", 4, 4900),
    taxRate: REVERSE_CHARGE_RATE,
    latestPeriodStartOn: -23,
    count: 3,
  }),
  special({
    id: "in_1Pk3RuKZ7WmHs2pr",
    tenantId: W.umbrella,
    planId: P.business,
    status: "paid",
    currency: EUR,
    taxRate: REVERSE_CHARGE_RATE,
    issuedOn: -23,
    periodStartOn: -23,
    lines: [
      { description: "Unused time on Pro", quantity: 1, unitAmount: -1460 },
      {
        description: "Remaining time on Business × 4 seats",
        quantity: 1,
        unitAmount: 22700,
      },
    ],
  }),
  {
    id: "in_1Nb6TyKZ2QeLw9yr",
    tenantId: W.wayne,
    planId: P.enterprise,
    status: "paid",
    currency: EUR,
    taxRate: REVERSE_CHARGE_RATE,
    issuedOn: -248,
    periodStartOn: -248,
    periodEndOn: -248 + YEAR_DAYS,
    lines: [seats("Enterprise (yearly)", 12, 82800)],
  },
  special({
    id: "in_1Nb6TyKZ2QeLw9us",
    tenantId: W.wayne,
    planId: null,
    status: "paid",
    currency: USD,
    taxRate: REVERSE_CHARGE_RATE,
    issuedOn: -10,
    periodStartOn: -10,
    lines: [
      {
        description: "Data residency audit (one-off)",
        quantity: 1,
        unitAmount: 294000,
      },
    ],
  }),
  ...paidMonthlyInvoices({
    idPrefix: "in_1Oj4HdKZ8VnPq3",
    tenantId: W.initech,
    planId: P.business,
    line: INITECH_SEATS,
    taxRate: REVERSE_CHARGE_RATE,
    latestPeriodStartOn: -39,
    count: 8,
  }),
  special({
    id: "in_1Oj4HdKZ8VnPq3op",
    tenantId: W.initech,
    planId: P.business,
    status: "open",
    currency: EUR,
    taxRate: REVERSE_CHARGE_RATE,
    issuedOn: -9,
    periodStartOn: -9,
    lines: [INITECH_SEATS],
  }),
  ...paidMonthlyInvoices({
    idPrefix: "in_1Mh2ZcKZ5KtRb8",
    tenantId: W.acme,
    planId: P.business,
    line: ACME_SEATS,
    taxRate: FRENCH_VAT_RATE,
    latestPeriodStartOn: -19,
    count: 12,
  }),
  special({
    id: "in_1Mh2ZcKZ5KtRb8dr",
    tenantId: W.acme,
    planId: P.business,
    status: "draft",
    currency: EUR,
    taxRate: FRENCH_VAT_RATE,
    issuedOn: 0,
    periodStartOn: 11,
    lines: [ACME_SEATS],
  }),
  special({
    id: "in_1Qs9TkKZ4MbVx6tr",
    tenantId: W.stark,
    planId: P.pro,
    status: "paid",
    currency: EUR,
    taxRate: REVERSE_CHARGE_RATE,
    issuedOn: -22,
    periodStartOn: -22,
    lines: [
      { description: "Trial period for Pro", quantity: 1, unitAmount: 0 },
    ],
  }),
  ...paidMonthlyInvoices({
    idPrefix: "in_1Lq7WnKZ3GzJc1",
    tenantId: W.hooli,
    planId: P.team,
    line: flat("Team", 15000),
    taxRate: REVERSE_CHARGE_RATE,
    latestPeriodStartOn: -53,
    count: 2,
  }),
  ...paidMonthlyInvoices({
    idPrefix: "in_1Kp5FsKZ9DwYh4",
    tenantId: W.piedPiper,
    planId: P.starter,
    line: flat("Starter", 900),
    taxRate: FRENCH_VAT_RATE,
    latestPeriodStartOn: -98,
    count: 3,
  }),
  special({
    id: "in_1Kp5FsKZ9DwYh4vo",
    tenantId: W.piedPiper,
    planId: P.starter,
    status: "void",
    currency: EUR,
    taxRate: FRENCH_VAT_RATE,
    issuedOn: -68,
    periodStartOn: -68,
    lines: [flat("Starter", 900)],
  }),
  special({
    id: "in_1Kp5FsKZ9DwYh4uc",
    tenantId: W.piedPiper,
    planId: P.starter,
    status: "uncollectible",
    currency: EUR,
    taxRate: FRENCH_VAT_RATE,
    issuedOn: -38,
    periodStartOn: -38,
    lines: [flat("Starter", 900)],
  }),
  ...paidMonthlyInvoices({
    idPrefix: "in_1Jr8GvKZ2NxTk5",
    tenantId: W.vandelay,
    planId: P.pro,
    line: flat("Pro", 2900),
    taxRate: REVERSE_CHARGE_RATE,
    latestPeriodStartOn: -40,
    count: 10,
  }),
];

export const CREDIT_NOTES: SeedCreditNote[] = [
  {
    id: "cn_1Q2m8LKZ4vTnR1aa",
    invoiceId: "in_1Q2m8LKZ4vTnR101",
    type: "credit_to_balance",
    status: "issued",
    amount: 4900,
    reason: "order_change",
    memo: "Seat billed after removal on the 2nd of the month",
    issuedOn: -30,
    refund: null,
  },
  {
    id: "cn_1Lq7WnKZ3GzJc1aa",
    invoiceId: "in_1Lq7WnKZ3GzJc100",
    type: "refund",
    status: "issued",
    amount: 15000,
    reason: "product_unsatisfactory",
    memo: "Money-back guarantee · requested by workspace owner",
    issuedOn: -50,
    refund: { id: "re_3Lq7WnKZ3GzJc1aa", status: "succeeded" },
  },
  {
    id: "cn_1Nb6TyKZ2QeLw9aa",
    invoiceId: "in_1Nb6TyKZ2QeLw9yr",
    type: "post_payment",
    status: "issued",
    amount: 40000,
    reason: "order_change",
    memo: "SLA breach on two days last month, per contract §7.2",
    issuedOn: -14,
    refund: null,
  },
  {
    id: "cn_1Oj4HdKZ8VnPq3aa",
    invoiceId: "in_1Oj4HdKZ8VnPq3op",
    type: "pre_payment",
    status: "issued",
    amount: 4900,
    reason: "duplicate",
    memo: "One seat invoiced twice by the seat sync",
    issuedOn: -8,
    refund: null,
  },
  {
    id: "cn_1Kp5FsKZ9DwYh4aa",
    invoiceId: "in_1Kp5FsKZ9DwYh400",
    type: "credit_to_balance",
    status: "void",
    amount: 900,
    reason: "order_change",
    memo: "Issued on the wrong invoice",
    issuedOn: -95,
    refund: null,
  },
  {
    id: "cn_1Jr8GvKZ2NxTk5aa",
    invoiceId: "in_1Jr8GvKZ2NxTk500",
    type: "refund",
    status: "issued",
    amount: 1450,
    reason: "order_change",
    memo: "Prorated refund · cancelled mid-cycle",
    issuedOn: -25,
    refund: { id: "re_3Jr8GvKZ2NxTk5aa", status: "succeeded" },
  },
];
