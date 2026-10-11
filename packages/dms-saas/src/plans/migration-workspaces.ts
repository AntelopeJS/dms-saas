import type {
  ComposedText,
  KeyValueListItem,
  Tone,
} from "@antelopejs/interface-dms/base";
import { composed, countParam, valueText } from "../i18n/composed-text";
import {
  type MigrationDetailContext,
  type MigrationWorkspaceView,
  needsAttention,
} from "./migration-detail";
import { dateTimeParam } from "./migration-blocks";
import { FIRST_MIGRATION_ATTEMPT } from "./migration-outcomes";
import type { UncertainResolution } from "../workers/plan-migration-resolution";

const K = "saas.catalog.migrations.detail";

/** The two tabs of a migration's workspaces. */
type WorkspaceGroup = "attention" | "settled";

/** Where a workspace stands in Stripe, as the operator reads it. */
export type StripeSide = "source" | "target" | "other" | "none" | "unavailable";

/** Which plan Stripe bills a workspace on, next to the DMS's. */
export interface StripeReading {
  stripeSubscriptionId: string | null;
  stripeUrl: string | null;
  stripePlan: StripeSide;
  stripePlanName: string | null;
  dmsPlanName: string | null;
}

/** The Stripe subscription of each captured workspace, by workspace id. */
export interface WorkspaceSubscriptionRef {
  id: string;
  url: string;
}

/** One row of the migration's workspace table. */
export interface MigrationWorkspaceRow {
  _id: string;
  migrationId: string;
  name: string;
  outcome: MigrationWorkspaceView["status"];
  outcomeNote: ComposedText | null;
  attempt: number;
  stripeSubscriptionId: string | null;
  stripeUrl: string | null;
  reason: string | null;
  updatedAt: Date | null;
  timeText: ComposedText | null;
  group: WorkspaceGroup;
  isUncertain: boolean;
  canResolve: boolean;
}

function attemptNote(view: MigrationWorkspaceView): ComposedText | null {
  if (view.attempt <= FIRST_MIGRATION_ATTEMPT) return null;
  return composed(`${K}.attempt`, { count: countParam(view.attempt) });
}

/**
 * The captured workspaces as table rows, the ones needing an operator first,
 * each with what it may be offered: settling it by hand only while it is
 * uncertain on a settled run.
 */
export function migrationWorkspaceRows(
  context: MigrationDetailContext,
  subscriptions: Map<string, WorkspaceSubscriptionRef>,
): MigrationWorkspaceRow[] {
  return context.workspaces.map((view) => {
    const subscription = subscriptions.get(view.tenantId);
    return {
      _id: view.tenantId,
      migrationId: context.migration._id,
      name: view.name,
      outcome: view.status,
      outcomeNote: attemptNote(view),
      attempt: view.attempt,
      stripeSubscriptionId: subscription?.id ?? null,
      stripeUrl: subscription?.url ?? null,
      reason: view.error,
      updatedAt: view.updatedAt,
      timeText: view.updatedAt
        ? valueText(dateTimeParam(view.updatedAt, "day"))
        : null,
      group: needsAttention(view) ? "attention" : "settled",
      isUncertain: view.isUncertain,
      canResolve: view.isUncertain && context.abilities.canResolve,
    };
  });
}

const GROUP_FILTER = /^is:(.+)$/;

/**
 * The rows a tab asks for: `filter_group=is:attention` keeps the workspaces
 * needing an operator, any other value or none keeps every row.
 */
export function filterWorkspaceRows(
  rows: MigrationWorkspaceRow[],
  groupFilter: string | null | undefined,
): MigrationWorkspaceRow[] {
  const group = groupFilter?.match(GROUP_FILTER)?.[1];
  if (!group) return rows;
  return rows.filter((row) => row.group === group);
}

/** The header of the workspaces export. */
export const WORKSPACE_EXPORT_HEADER = [
  "workspace_id",
  "workspace",
  "outcome",
  "attempts",
  "stripe_subscription",
  "reason",
  "updated_at",
];

/** One CSV row of a captured workspace. */
export function workspaceExportRow(row: MigrationWorkspaceRow): string[] {
  return [
    row._id,
    row.name,
    row.outcome,
    String(row.attempt),
    row.stripeSubscriptionId ?? "",
    row.reason ?? "",
    row.updatedAt ? new Date(row.updatedAt).toISOString() : "",
  ];
}

const SIDE_TONES: Record<StripeSide, Tone> = {
  target: "success",
  source: "warning",
  other: "error",
  none: "neutral",
  unavailable: "neutral",
};

/** The Stripe side of a reading: its plan name, or what it found instead. */
export function stripePlanText(reading: StripeReading): string {
  return reading.stripePlanName ?? `$${K}.stripe_${reading.stripePlan}`;
}

/**
 * What Stripe and the DMS each say about an uncertain workspace, and what
 * that means for the operator settling it.
 */
export function stripeReadingItems(reading: StripeReading): KeyValueListItem[] {
  const subscription: KeyValueListItem = {
    id: "subscription",
    label: `$${K}.stripe_subscription`,
    value: reading.stripeSubscriptionId ?? `$${K}.stripe_none`,
    type: reading.stripeSubscriptionId ? "mono" : "text",
    copy: Boolean(reading.stripeSubscriptionId),
  };
  if (reading.stripeUrl) subscription.to = reading.stripeUrl;
  return [
    subscription,
    {
      id: "stripe",
      label: `$${K}.stripe_label`,
      value: stripePlanText(reading),
      type: "status",
      tone: SIDE_TONES[reading.stripePlan],
    },
    {
      id: "dms",
      label: `$${K}.dms_label`,
      value: reading.dmsPlanName ?? "—",
    },
    {
      id: "verdict",
      label: `$${K}.verdict`,
      value: `$${K}.verdict_${reading.stripePlan}`,
    },
  ];
}

/**
 * What the reading tells the operator to do, as the verdict words it: Stripe
 * bills the new plan, so the workspace moved; it bills the old one or
 * nothing, so it can be retried. Another price, or no reading, is for the
 * operator to look into first.
 */
const RESOLUTION_BY_SIDE: Record<StripeSide, UncertainResolution | null> = {
  target: "moved",
  source: "not_moved",
  none: "not_moved",
  other: null,
  unavailable: null,
};

/** The settlement a Stripe reading points to, if it points to one. */
export function recommendedResolution(
  reading: StripeReading,
): UncertainResolution | null {
  return RESOLUTION_BY_SIDE[reading.stripePlan];
}
