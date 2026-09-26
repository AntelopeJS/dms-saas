import type {
  UpcomingInvoicePreview,
  UpcomingInvoicePreviewAbsenceReason,
  UpcomingInvoicePreviewUnavailableReason,
} from "@antelopejs/interface-dms-saas/billing";

/** No upcoming invoice to preview, before it is stamped with a time. */
export interface AbsentPreviewOutcome {
  status: "absent";
  reason: UpcomingInvoicePreviewAbsenceReason;
}

/** No exact figures to give, before it is stamped with a time. */
export interface UnavailablePreviewOutcome {
  status: "unavailable";
  reason: UpcomingInvoicePreviewUnavailableReason;
}

export type PreviewOutcome = AbsentPreviewOutcome | UnavailablePreviewOutcome;

export function absent(
  reason: UpcomingInvoicePreviewAbsenceReason,
): AbsentPreviewOutcome {
  return { status: "absent", reason };
}

export function unavailable(
  reason: UpcomingInvoicePreviewUnavailableReason,
): UnavailablePreviewOutcome {
  return { status: "unavailable", reason };
}

export function stampOutcome(
  outcome: PreviewOutcome,
  computedAt: Date,
): UpcomingInvoicePreview {
  return { ...outcome, computedAt: computedAt.toISOString() };
}
