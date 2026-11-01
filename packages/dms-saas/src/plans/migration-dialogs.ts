import type { ConfirmDialogImpact } from "@antelopejs/interface-dms/base";
import {
  type ConfirmDialogSerialized,
  serializeConfirmDialog,
} from "@antelopejs/interface-dms/base/table-view";
import { DefaultDataTypes } from "@antelopejs/interface-dms/base/data-types/default-types";
import type {
  MigrationDetailContext,
  MigrationWorkspaceView,
} from "./migration-detail";
import type { UncertainResolution } from "../workers/plan-migration-resolution";
import { type StripeReading, stripePlanText } from "./migration-workspaces";

const T = "$saas.catalog.migrations";
const NOTE_MAX_LENGTH = 500;
const NOTE_ROWS = 3;
/** The field the reconcile route reads its audit note from. */
export const RECONCILE_NOTE_FIELD = "note";

/**
 * "Retry moving 2 workspaces to Team?": what is retried, what is skipped
 * because Stripe may have moved it already.
 */
export function retryDialog(
  context: MigrationDetailContext,
): ConfirmDialogSerialized {
  const failed = context.workspaces.filter((view) => view.status === "failed");
  const impact: ConfirmDialogImpact[] = [
    {
      icon: "i-ph-buildings",
      label: `${T}.retry.impact_retried`,
      count: failed.length,
    },
  ];
  if (context.totals.uncertain > 0) {
    impact.push({
      icon: "i-ph-question",
      label: `${T}.retry.impact_skipped`,
      count: context.totals.uncertain,
    });
  }
  return serializeConfirmDialog({
    title: `${T}.retry.title`,
    description: `${T}.retry.description`,
    params: {
      count: failed.length,
      name: failed[0]?.name ?? "",
      to: context.to.name,
      from: context.from.name,
    },
    icon: "i-ph-arrows-clockwise",
    color: "primary",
    impact,
    confirmLabel: `${T}.retry.confirm`,
  });
}

/**
 * "Close this migration with 2 workspaces left on Starter?", with the audit
 * note the server requires.
 */
export function reconcileDialog(
  context: MigrationDetailContext,
): ConfirmDialogSerialized {
  return serializeConfirmDialog({
    title: `${T}.reconcile.title`,
    description: `${T}.reconcile.description`,
    params: { count: context.totals.notMoved, from: context.from.name },
    icon: "i-ph-check-square",
    color: "warning",
    impact: [
      {
        icon: "i-ph-buildings",
        label: `${T}.reconcile.impact_kept`,
        count: context.totals.notMoved,
      },
    ],
    confirmLabel: `${T}.reconcile.confirm`,
    fields: [
      {
        id: RECONCILE_NOTE_FIELD,
        label: `${T}.reconcile.note`,
        required: true,
        type: new DefaultDataTypes.StringType({
          textarea: true,
          rows: NOTE_ROWS,
          maxLength: NOTE_MAX_LENGTH,
          placeholder: `${T}.reconcile.note_placeholder`,
        }),
      },
    ],
  });
}

/**
 * Settling a workspace one way while Stripe reads the other way is what the
 * dialog warns about: its colour says so before the operator reads it.
 */
const AGREEING_SIDE: Record<UncertainResolution, StripeReading["stripePlan"]> =
  {
    moved: "target",
    not_moved: "source",
  };

/**
 * "Mark Pied Piper as moved?", with what Stripe and the DMS each say right
 * now, read when the dialog opens, so the operator settles on a reading.
 */
export function resolveDialog(
  context: MigrationDetailContext,
  view: MigrationWorkspaceView,
  resolution: UncertainResolution,
  reading: StripeReading,
): ConfirmDialogSerialized {
  const agrees = reading.stripePlan === AGREEING_SIDE[resolution];
  const isMoved = resolution === "moved";
  return serializeConfirmDialog({
    title: `${T}.resolve.${resolution}_title`,
    description: `${T}.resolve.${resolution}_description`,
    params: { name: view.name, from: context.from.name, to: context.to.name },
    icon: isMoved ? "i-ph-check-circle" : "i-ph-arrow-counter-clockwise",
    color: agrees ? "primary" : "warning",
    impact: [
      {
        icon: "i-ph-stripe-logo",
        label: `${T}.detail.stripe_label`,
        count: stripePlanText(reading),
      },
      {
        icon: "i-ph-database",
        label: `${T}.detail.dms_label`,
        count: reading.dmsPlanName ?? "—",
      },
    ],
    confirmLabel: `${T}.resolve.${resolution}_confirm`,
  });
}
