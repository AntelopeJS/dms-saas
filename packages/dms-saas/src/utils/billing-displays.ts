import { ColumnDisplay, RegisterDisplay } from "@antelopejs/interface-dms/base";

/**
 * An invoice's status as a pill in the invoice tone, with what Stripe is doing
 * about it under it ("Payment failed · retry Oct 2", "Finalises Oct 1",
 * "Replaced by INV-0936"), read off the row.
 */
@RegisterDisplay("saas:invoice_status")
export class InvoiceStatusDisplay extends ColumnDisplay<
  Record<string, never>
> {}

/** Where a workspace cell finds the plan and seat count it shows. */
export interface WorkspacePlanDisplayOptions {
  /** Row field holding the plan name. */
  planField: string;
  /** Row field holding the number of seats billed. */
  seatsField?: string;
}

/** A workspace name over its plan and seats ("Business · 23 seats"). */
@RegisterDisplay("saas:workspace_plan")
export class WorkspacePlanDisplay extends ColumnDisplay<WorkspacePlanDisplayOptions> {}

/** Where a period cell finds the end of the period. */
export interface BillingPeriodDisplayOptions {
  /** Row field holding the end of the period. */
  endField: string;
}

/** A billing period from the column's date to the end field ("Sep 29 – Oct 28"). */
@RegisterDisplay("saas:period")
export class BillingPeriodDisplay extends ColumnDisplay<BillingPeriodDisplayOptions> {}

/** Where a reason cell finds the operator's memo. */
export interface CreditReasonDisplayOptions {
  /** Row field holding the internal memo shown under the reason. */
  memoField?: string;
}

/**
 * Why a credit note was issued: the operator's reason in words, else what
 * Stripe recorded, the internal memo under it.
 */
@RegisterDisplay("saas:credit_reason")
export class CreditReasonDisplay extends ColumnDisplay<CreditReasonDisplayOptions> {}

/** Who issued a credit note: the operator's name, or "Automatic". */
@RegisterDisplay("saas:issuer")
export class IssuerDisplay extends ColumnDisplay<Record<string, never>> {}
