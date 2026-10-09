import type { Tone } from "@antelopejs/interface-dms/base";
import { DefaultDisplays } from "@antelopejs/interface-dms/base";
import { DefaultDataTypes } from "@antelopejs/interface-dms/base/data-types/default-types";
import type { FormComponents } from "@antelopejs/interface-dms/base/form-schema";
import {
  BILLING_STATES,
  CREDIT_NOTE_STATUSES,
  CREDIT_NOTE_TYPES,
  INVOICE_STATUSES,
  PLAN_MIGRATION_STATUSES,
  WORKSPACE_OWNER_STATUSES,
} from "../db";

/**
 * One colour per status across the module: a workspace, an invoice, a credit
 * note or a migration reads the same in every table, card and banner. The
 * frontend mirrors these tables in `useSaasStatus`; a test keeps them equal.
 */
export const STATUS_TONES = {
  workspace: {
    active: "success",
    trialing: "info",
    free: "primary",
    past_due: "error",
    pending_payment: "warning",
    suspended: "error",
    cancelled: "neutral",
  },
  invoice: {
    draft: "neutral",
    open: "warning",
    paid: "success",
    void: "neutral",
    uncollectible: "error",
    issued: "success",
  },
  credit_note: {
    issued: "success",
    void: "neutral",
  },
  credit_note_type: {
    pre_payment: "neutral",
    post_payment: "neutral",
    credit_to_balance: "primary",
    refund: "info",
    mixed: "neutral",
  },
  migration: {
    pending: "neutral",
    running: "info",
    completed: "success",
    failed: "error",
    partially_failed: "warning",
    reconciliation_required: "error",
  },
  owner: {
    joined: "success",
    invited: "warning",
    expired: "error",
    none: "neutral",
  },
} as const satisfies Record<string, Record<string, Tone>>;

/** A family of statuses sharing one vocabulary and one tone table. */
export type StatusFamily = keyof typeof STATUS_TONES;

const STATUS_VALUES: Record<StatusFamily, readonly string[]> = {
  workspace: BILLING_STATES,
  invoice: [...INVOICE_STATUSES, "issued"],
  credit_note: CREDIT_NOTE_STATUSES,
  credit_note_type: CREDIT_NOTE_TYPES,
  migration: PLAN_MIGRATION_STATUSES,
  owner: WORKSPACE_OWNER_STATUSES,
};

/** The i18n key of one status label. */
export function statusLabelKey(family: StatusFamily, status: string): string {
  return `$saas.status.${family}.${status}`;
}

/** Select items naming every status of a family, for columns and filters. */
export function statusItems(
  family: StatusFamily,
): FormComponents.SelectOption[] {
  return STATUS_VALUES[family].map((status) => ({
    label: statusLabelKey(family, status),
    value: status,
  }));
}

/** A select type over a status family, so filters list the human labels. */
export function statusType(family: StatusFamily): DefaultDataTypes.SelectType {
  return new DefaultDataTypes.SelectType({ items: statusItems(family) });
}

/** The line a status pill may carry under it, read off the row. */
export type StatusSubline = Pick<
  DefaultDisplays.StatusPillDisplayOptions,
  "subField" | "subTone"
>;

/**
 * The status as a tinted pill in the family's tone, with an optional line
 * under it read from `subField` ("Payment failed · retry Oct 2").
 */
export function statusPillDisplay(
  family: StatusFamily,
  subline: StatusSubline = {},
): DefaultDisplays.StatusPillDisplay {
  return new DefaultDisplays.StatusPillDisplay({
    tones: { ...STATUS_TONES[family] },
    ...subline,
  });
}
