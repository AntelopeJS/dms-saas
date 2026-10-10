import type { BillingState, PlanBillingMode, PlanInterval } from "../db";

// Plans store their price in major units and the Stripe sync bills it times
// 100 (see `stripe/sync-plan.ts`): MRR reads the same figure Stripe charges.
const PLAN_PRICE_MINOR_FACTOR = 100;

const MONTHS_PER_INTERVAL: Record<PlanInterval, number> = {
  month: 1,
  year: 12,
};

// Past due is still billed (the invoice is at risk, not written off); a
// trial, a suspension, a pending first payment or a cancellation bill nothing.
const BILLED_STATES: ReadonlySet<BillingState> = new Set([
  "active",
  "past_due",
]);

const MIN_BILLED_SEATS = 1;

/** The plan terms MRR is computed from. */
export interface MrrPlanTerms {
  /** Price in major units, per seat for a `seat` plan. */
  price: number;
  currency: string;
  interval: PlanInterval;
  billingMode: PlanBillingMode;
}

/** What one workspace's MRR depends on. */
export interface MrrInput {
  billingState: BillingState;
  isComplimentary: boolean;
  plan: MrrPlanTerms | null;
  /** Seats Stripe bills: members and pending invitations. */
  billedSeats: number;
}

/** An amount in minor units of a currency (uppercase ISO 4217 code). */
export interface MinorAmount {
  amountMinor: number;
  currency: string;
}

/** Amounts summed in the reporting currency, and those left out of it. */
export interface ReportingTotal extends MinorAmount {
  /** Sums per other currency, never converted: no exchange rate is assumed. */
  otherCurrencies: MinorAmount[];
}

/** The plan's unit price in minor units, as the Stripe sync bills it. */
export function planUnitAmountMinor(plan: Pick<MrrPlanTerms, "price">): number {
  return Math.round(plan.price * PLAN_PRICE_MINOR_FACTOR);
}

/** A plan's billing terms with its unit price already in minor units. */
export interface BilledTerms {
  unitAmountMinor: number;
  interval: PlanInterval;
  billingMode: PlanBillingMode;
}

/**
 * What these terms bill per month at this seat count: yearly prices divided
 * by 12, seat prices times the billed seats (at least one).
 */
export function monthlyAmountMinor(
  terms: BilledTerms,
  billedSeats: number,
): number {
  const seats =
    terms.billingMode === "seat" ? Math.max(MIN_BILLED_SEATS, billedSeats) : 1;
  return Math.round(
    (terms.unitAmountMinor * seats) / MONTHS_PER_INTERVAL[terms.interval],
  );
}

/** What the plan bills per month at this seat count, whatever the state. */
export function monthlyPlanAmountMinor(
  plan: MrrPlanTerms,
  billedSeats: number,
): number {
  return monthlyAmountMinor(
    {
      unitAmountMinor: planUnitAmountMinor(plan),
      interval: plan.interval,
      billingMode: plan.billingMode,
    },
    billedSeats,
  );
}

/**
 * Normalised monthly recurring revenue of one workspace: what it pays per
 * month on its plan. Trials, complimentary access, free plans and workspaces
 * not billed (suspended, pending payment, cancelled) count for 0.
 */
export function normalisedMrr(input: MrrInput): MinorAmount {
  const currency = (input.plan?.currency ?? "").toUpperCase();
  const isBilled =
    !!input.plan &&
    !input.isComplimentary &&
    BILLED_STATES.has(input.billingState) &&
    input.plan.price > 0;
  if (!isBilled || !input.plan) return { amountMinor: 0, currency };
  return {
    amountMinor: monthlyPlanAmountMinor(input.plan, input.billedSeats),
    currency,
  };
}

function addTo(
  totals: Map<string, number>,
  { currency, amountMinor }: MinorAmount,
): Map<string, number> {
  totals.set(currency, (totals.get(currency) ?? 0) + amountMinor);
  return totals;
}

/**
 * Sums amounts in the reporting currency. Amounts in other currencies are
 * summed apart, per currency, so a screen can say they exist rather than
 * mixing them in.
 */
export function sumInReportingCurrency(
  amounts: readonly MinorAmount[],
  reportingCurrency: string,
): ReportingTotal {
  const currency = reportingCurrency.toUpperCase();
  const totals = amounts
    .filter((amount) => amount.amountMinor !== 0 && amount.currency)
    .map((amount) => ({ ...amount, currency: amount.currency.toUpperCase() }))
    .reduce(addTo, new Map<string, number>());
  const otherCurrencies = [...totals.entries()]
    .filter(([code]) => code !== currency)
    .map(([code, amountMinor]) => ({ currency: code, amountMinor }))
    .sort((left, right) => left.currency.localeCompare(right.currency));
  return {
    amountMinor: totals.get(currency) ?? 0,
    currency,
    otherCurrencies,
  };
}
