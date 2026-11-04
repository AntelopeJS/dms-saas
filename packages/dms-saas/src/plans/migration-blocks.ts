import type {
  ActivityFeedItem,
  BannerAction,
  BannerButtonAction,
  BannerContent,
  BannerTone,
  BlockText,
  ComposedText,
  ComposedTextDateFormat,
  ComposedTextParam,
  KeyValueListItem,
  StatGroupItem,
  Tone,
} from "@antelopejs/interface-dms/base";
import { ButtonVariant } from "@antelopejs/interface-dms/base/types/button";
import type { PlanMigrationFeatureChange } from "../db";
import {
  composed,
  countParam,
  dotList,
  moneyParam,
} from "../i18n/composed-text";
import { STATUS_TONES } from "../utils/status-vocabulary";
import {
  type MigrationDetailContext,
  type MigrationPlanRef,
  type MigrationTotals,
  type MigrationWorkspaceView,
  firstUncertain,
} from "./migration-detail";
import { toMinorUnits } from "../utils/money";
import { PLAN_UNLIMITED } from "../db";
import { isNumber, isString } from "../utils/primitive-guards";

const K = "saas.catalog.migrations.detail";
const REASON_KEY = "saas.catalog.migrations.reason";
const STATUS_KEY = "saas.status.migration";
const MIGRATION_ICON = "i-ph-arrows-clockwise";
const DEFAULT_BANNER_TONE: BannerTone = "info";
const BANNER_TONES = [
  "info",
  "success",
  "warning",
  "error",
  "primary",
] as const satisfies readonly BannerTone[];

/** Where the detail's routes and the list page live. */
export interface MigrationDetailUrls {
  api: string;
  list: string;
}

/** "2 of 5 not moved": the state line of a migration's attention card. */
export function attentionState(totals: MigrationTotals): ComposedText {
  return composed("saas.catalog.migrations.attention.state", {
    count: countParam(totals.notMoved),
    total: countParam(totals.captured),
  });
}

/** A date and its time, written in the reader's language. */
export function dateTimeParam(
  date: Date | string,
  format: ComposedTextDateFormat = "medium",
): ComposedTextParam {
  return { type: "datetime", value: new Date(date).toISOString(), format };
}

const MIGRATION_TONES = new Map<string, Tone>(
  Object.entries(STATUS_TONES.migration),
);

function bannerTone(status: string): BannerTone {
  const tone = MIGRATION_TONES.get(status);
  return (
    (tone && BANNER_TONES.find((banner) => banner === tone)) ||
    DEFAULT_BANNER_TONE
  );
}

function personName(context: MigrationDetailContext, userId?: string | null) {
  return (userId && context.people.get(userId)) || userId || "";
}

function startedText(context: MigrationDetailContext): ComposedText {
  const { migration } = context;
  return composed(`${K}.started`, {
    date: dateTimeParam(migration.createdAt),
    name: personName(context, migration.initiatedBy),
    reason: composed(`${REASON_KEY}.${migration.reason}`),
  });
}

function blockerText(context: MigrationDetailContext): ComposedText | null {
  const uncertain = firstUncertain(context);
  if (!uncertain || !context.abilities.canResolve) return null;
  return composed(`${K}.resolve_first`, { name: uncertain.name });
}

function exportAction(api: string): BannerButtonAction {
  return {
    label: `$${K}.export`,
    icon: "i-ph-file-csv",
    variant: ButtonVariant.outline,
    color: "neutral",
    target: {
      type: "exportJob",
      url: `${api}/workspaces-export/start`,
      method: "POST",
      labels: {
        title: `$${K}.export_job.title`,
        exporting: `$${K}.export_job.preparing`,
        successTitle: `$${K}.export_job.success_title`,
        successMessage: `$${K}.export_job.success_message`,
        errorTitle: `$${K}.export_job.error_title`,
        retry: `$${K}.export_job.retry`,
      },
    },
  };
}

function retryAction(api: string): BannerButtonAction {
  return {
    label: `$${K}.retry_action`,
    icon: MIGRATION_ICON,
    color: "primary",
    target: {
      type: "api",
      url: `${api}/retry`,
      method: "POST",
      successMessage: "$saas.catalog.migrations.retry.started",
    },
    confirm: { from: `${api}/dialogs/retry` },
  };
}

function reconcileAction(api: string): BannerButtonAction {
  return {
    label: `$${K}.mark_reconciled`,
    icon: "i-ph-check-square",
    variant: ButtonVariant.outline,
    color: "neutral",
    target: {
      type: "api",
      url: `${api}/reconcile`,
      method: "POST",
      successMessage: `$${K}.reconciled_toast`,
    },
    confirm: { from: `${api}/dialogs/reconcile` },
  };
}

function headerActions(
  context: MigrationDetailContext,
  urls: MigrationDetailUrls,
): BannerAction[] {
  const api = `${urls.api}/${context.migration._id}`;
  const { abilities } = context;
  return [
    {
      label: `$${K}.back`,
      to: urls.list,
      icon: "i-ph-arrow-left",
      variant: "ghost",
      color: "neutral",
    },
    exportAction(api),
    ...(abilities.canReconcile ? [reconcileAction(api)] : []),
    ...(abilities.canRetry ? [retryAction(api)] : []),
  ];
}

/**
 * The head of a migration: which plans, where it stands, who started it and
 * why, and what the operator can do now — every action the server allows,
 * none it would refuse.
 */
export function migrationHeader(
  context: MigrationDetailContext,
  urls: MigrationDetailUrls,
): BannerContent {
  const { migration } = context;
  const lines = [
    composed(`${STATUS_KEY}.${migration.status}`),
    startedText(context),
    blockerText(context),
  ].filter((line): line is ComposedText => line !== null);
  return {
    title: composed(`${K}.title`, {
      from: context.from.name,
      to: context.to.name,
    }),
    description: dotList(lines) ?? undefined,
    tone: bannerTone(migration.status),
    icon: MIGRATION_ICON,
    actions: headerActions(context, urls),
  };
}

function notMovedDetail(
  context: MigrationDetailContext,
): BlockText | undefined {
  const { totals } = context;
  const parts = [
    ["uncertain", totals.uncertain],
    ["failed", totals.failed],
  ] as const;
  const lines = parts
    .filter(([, count]) => count > 0)
    .map(([kind, count]) =>
      composed(`${K}.not_moved_${kind}`, { count: countParam(count) }),
    );
  return dotList(lines) ?? undefined;
}

/** The counts heading a migration: captured, moved, not moved, told. */
export function migrationTotalItems(
  context: MigrationDetailContext,
): StatGroupItem[] {
  const { totals, migration } = context;
  return [
    {
      id: "captured",
      icon: "i-ph-camera",
      eyebrow: `$${K}.captured`,
      value: totals.captured,
    },
    {
      id: "moved",
      icon: "i-ph-check-circle",
      tone: "success",
      eyebrow: `$${K}.moved`,
      value: totals.moved,
    },
    {
      id: "not-moved",
      icon: "i-ph-warning-circle",
      tone: totals.notMoved > 0 ? "error" : "muted",
      eyebrow: `$${K}.not_moved`,
      value: totals.notMoved,
      detail: notMovedDetail(context),
    },
    {
      id: "notified",
      icon: "i-ph-bell",
      eyebrow: `$${K}.notified`,
      value: totals.notified,
      detail: migration.notifyMembers ? undefined : `$${K}.notified_off`,
    },
  ];
}

/** Feature names by key, in the reader's language. */
export type FeatureNames = Map<string, string>;

function featureValue(
  change: PlanMigrationFeatureChange,
  side: "oldValue" | "newValue",
): ComposedTextParam {
  const value = change[side];
  if (value === true) return composed(`${K}.change.included`);
  if (value === false) return composed(`${K}.change.excluded`);
  if (value === null || value === undefined || value === PLAN_UNLIMITED) {
    return composed(`${K}.change.unlimited`);
  }
  if (isNumber(value) || isString(value)) return value;
  return JSON.stringify(value);
}

function changedFeatureItem(
  change: PlanMigrationFeatureChange,
  names: FeatureNames,
): KeyValueListItem {
  return {
    id: `feature-${change.key}`,
    label: names.get(change.key) ?? change.key,
    value: composed(`${K}.change.from_to`, {
      from: featureValue(change, "oldValue"),
      to: featureValue(change, "newValue"),
    }),
  };
}

function listedFeatureItems(
  keys: readonly string[],
  names: FeatureNames,
  kind: "added" | "removed",
): KeyValueListItem[] {
  return keys.map((key) => ({
    id: `feature-${key}`,
    label: names.get(key) ?? key,
    value: `$${K}.change.feature_${kind}`,
    tone: kind === "added" ? "success" : "warning",
  }));
}

function priceText(plan: MigrationPlanRef): ComposedTextParam | null {
  if (plan.price === null || !plan.currency) return null;
  return moneyParam(toMinorUnits(plan.price, plan.currency), plan.currency);
}

function priceItems(context: MigrationDetailContext): KeyValueListItem[] {
  const from = priceText(context.from);
  const to = priceText(context.to);
  if (!from || !to || context.from.price === context.to.price) return [];
  return [
    {
      id: "price",
      label: `$${K}.change.price`,
      value: composed(`${K}.change.from_to`, { from, to }),
    },
  ];
}

function permissionItems(context: MigrationDetailContext): KeyValueListItem[] {
  const diff = context.migration.permissionDiff;
  const counts = {
    added: diff?.added?.length ?? 0,
    removed: diff?.removed?.length ?? 0,
  };
  return (["added", "removed"] as const)
    .filter((kind) => counts[kind] > 0)
    .map((kind) => ({
      id: `permissions-${kind}`,
      label: `$${K}.change.permissions_${kind}`,
      value: composed(`${K}.change.permission_count`, {
        count: countParam(counts[kind]),
      }),
    }));
}

/**
 * What changes for a moved workspace: the price, the features its new plan
 * adds, drops or sets differently, and the permissions its roles gain or
 * lose.
 */
export function migrationChangeItems(
  context: MigrationDetailContext,
  names: FeatureNames,
): KeyValueListItem[] {
  const diff = context.migration.featureDiff;
  return [
    ...priceItems(context),
    ...(diff?.changed ?? []).map((change) => changedFeatureItem(change, names)),
    ...listedFeatureItems(diff?.added ?? [], names, "added"),
    ...listedFeatureItems(diff?.removed ?? [], names, "removed"),
    ...permissionItems(context),
  ];
}

function isoDate(date: Date | string): string {
  return new Date(date).toISOString();
}

function resolutionItem(
  context: MigrationDetailContext,
  view: MigrationWorkspaceView,
): ActivityFeedItem | null {
  if (!view.resolvedBy || !view.updatedAt) return null;
  const isMoved = view.status === "succeeded";
  return {
    id: `resolved-${view.tenantId}`,
    icon: isMoved ? "i-ph-check-circle" : "i-ph-arrow-counter-clockwise",
    tone: isMoved ? "success" : "warning",
    title: composed(
      `${K}.journal.${isMoved ? "resolved_moved" : "resolved_not_moved"}`,
      { name: personName(context, view.resolvedBy), workspace: view.name },
    ),
    date: isoDate(view.updatedAt),
  };
}

function finishedItem(
  context: MigrationDetailContext,
): ActivityFeedItem | null {
  const { migration } = context;
  if (!migration.completedAt) return null;
  return {
    id: "finished",
    icon: "i-ph-flag-checkered",
    tone: STATUS_TONES.migration[migration.status],
    title: `$${K}.journal.finished`,
    meta: [
      composed(`${STATUS_KEY}.${migration.status}`),
      composed(`${K}.journal.outcome`, {
        moved: context.totals.moved,
        captured: context.totals.captured,
      }),
    ],
    date: isoDate(migration.completedAt),
  };
}

function reconciledItem(
  context: MigrationDetailContext,
): ActivityFeedItem | null {
  const { migration } = context;
  if (!migration.reconciledAt) return null;
  return {
    id: "reconciled",
    icon: "i-ph-check-square",
    tone: "info",
    title: composed(`${K}.journal.reconciled`, {
      name: personName(context, migration.reconciledBy),
    }),
    meta: migration.reconciliationNote ? [migration.reconciliationNote] : [],
    date: isoDate(migration.reconciledAt),
  };
}

function startedItem(context: MigrationDetailContext): ActivityFeedItem {
  const { migration } = context;
  return {
    id: "started",
    icon: MIGRATION_ICON,
    tone: "primary",
    title: composed(`${K}.journal.started`, {
      name: personName(context, migration.initiatedBy),
    }),
    meta: [
      composed(`${K}.journal.captured`, {
        count: countParam(context.totals.captured),
      }),
    ],
    date: isoDate(migration.createdAt),
  };
}

/**
 * The migration's journal, newest first: who started it, who settled an
 * uncertain workspace by hand, when it finished, who closed it and why.
 */
export function migrationJournalItems(
  context: MigrationDetailContext,
): ActivityFeedItem[] {
  const items = [
    startedItem(context),
    ...context.workspaces.map((view) => resolutionItem(context, view)),
    finishedItem(context),
    reconciledItem(context),
  ].filter((item): item is ActivityFeedItem => item !== null);
  return items.sort((left, right) =>
    (right.date ?? "").localeCompare(left.date ?? ""),
  );
}
