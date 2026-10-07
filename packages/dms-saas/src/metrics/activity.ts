import type { ActivityFeedItem, Tone } from "@antelopejs/interface-dms/base";
import type { Invoice } from "../db";
import type { ServerMessages } from "../i18n/server-messages";
import type { OperatorAction } from "../operator-actions/db/operator-action.table";
import type { WorkspaceOperatorAction } from "../operator-actions/types";
import { getRowInstance } from "../utils/row-instance";

/** The activity feeds offered: everything, money movements, or lifecycle. */
export const ACTIVITY_KINDS = ["all", "billing", "lifecycle"] as const;
export type ActivityKind = (typeof ACTIVITY_KINDS)[number];

type EntryKind = Exclude<ActivityKind, "all">;

/** A workspace as the activity feed names it. */
export interface ActivityWorkspace {
  _id: string;
  name: string;
  createdAt: Date;
}

/** Everything an activity feed is built from. */
export interface ActivitySources {
  documents: Invoice[];
  actions: OperatorAction[];
  workspaces: ActivityWorkspace[];
  /** Workspace names by id, for documents and actions. */
  names: ReadonlyMap<string, string>;
}

/** How a feed is built: which entries, how many, where they link. */
export interface ActivityOptions {
  kind: ActivityKind;
  limit: number;
  messages: ServerMessages;
  /** Detail page of a workspace; left out on that page itself. */
  linkOf?: (tenantId: string) => string;
}

interface ActivityEntry {
  kind: EntryKind;
  at: Date;
  item: ActivityFeedItem;
}

interface DocumentLook {
  icon: string;
  tone: Tone;
  title: string;
}

interface ActionLook {
  kind: EntryKind;
  icon: string;
  tone: Tone;
  title: string;
}

const KEY_PREFIX = "$saas.activity";
// A platform feed, which links each entry to its workspace, names the
// workspace in the title; a workspace's own feed does not repeat it.
const PLATFORM_TITLES = "platform";
const WORKSPACE_TITLES = "workspace";

const DOCUMENT_LOOKS: Record<string, DocumentLook> = {
  paid: { icon: "i-ph-check-circle", tone: "success", title: "invoice_paid" },
  open: { icon: "i-ph-hourglass", tone: "warning", title: "invoice_open" },
  uncollectible: {
    icon: "i-ph-warning-octagon",
    tone: "error",
    title: "invoice_uncollectible",
  },
  issued: {
    icon: "i-ph-arrow-u-down-left",
    tone: "info",
    title: "credit_note_issued",
  },
};

const ACTION_LOOKS: Partial<Record<WorkspaceOperatorAction, ActionLook>> = {
  "workspace.suspend": {
    kind: "lifecycle",
    icon: "i-ph-prohibit",
    tone: "error",
    title: "workspace_suspended",
  },
  "workspace.unsuspend": {
    kind: "lifecycle",
    icon: "i-ph-play-circle",
    tone: "success",
    title: "workspace_reactivated",
  },
  "subscription.upgrade": {
    kind: "billing",
    icon: "i-ph-arrow-circle-up",
    tone: "primary",
    title: "subscription_upgraded",
  },
  "customer_balance.credit": {
    kind: "billing",
    icon: "i-ph-coins",
    tone: "info",
    title: "balance_credited",
  },
  "invitation.resend": {
    kind: "lifecycle",
    icon: "i-ph-envelope-simple",
    tone: "neutral",
    title: "invitation_resent",
  },
};

function key(name: string): string {
  return `${KEY_PREFIX}.${name}`;
}

function titleKey(options: ActivityOptions, name: string): string {
  const titles = options.linkOf ? PLATFORM_TITLES : WORKSPACE_TITLES;
  return key(`${titles}.${name}`);
}

function linkTo(
  options: ActivityOptions,
  tenantId: string,
): string | undefined {
  return options.linkOf?.(tenantId);
}

function documentEntry(
  document: Invoice,
  sources: ActivitySources,
  options: ActivityOptions,
): ActivityEntry | null {
  const look = DOCUMENT_LOOKS[document.status];
  if (!look) return null;
  const tenantId = getRowInstance(document);
  const at = new Date(document.paidAt ?? document.issuedAt);
  const amount = document.total || document.amount;
  return {
    kind: "billing",
    at,
    item: {
      id: `document-${document._id}`,
      icon: look.icon,
      tone: look.tone,
      title: titleKey(options, look.title),
      meta: [options.messages.money(amount, document.currency)],
      params: {
        number: document.number ?? "—",
        workspace: sources.names.get(tenantId) ?? "—",
      },
      date: at.toISOString(),
      to: linkTo(options, tenantId),
    },
  };
}

function detailString(action: OperatorAction, field: string): string {
  const value = action.details?.[field];
  return typeof value === "string" ? value : "—";
}

function actionMeta(
  action: OperatorAction,
  options: ActivityOptions,
): string[] {
  const amount = action.details?.amountCents;
  const currency = action.details?.currency;
  const money =
    typeof amount === "number" && typeof currency === "string"
      ? [options.messages.money(amount, currency)]
      : [];
  return [...money, key("by_operator")];
}

function actionEntry(
  action: OperatorAction,
  sources: ActivitySources,
  options: ActivityOptions,
): ActivityEntry | null {
  const look = ACTION_LOOKS[action.action];
  if (!look || action.status !== "succeeded") return null;
  const at = new Date(action.effectiveAt ?? action.createdAt);
  return {
    kind: look.kind,
    at,
    item: {
      id: `action-${action._id}`,
      icon: look.icon,
      tone: look.tone,
      title: titleKey(options, look.title),
      meta: actionMeta(action, options),
      params: {
        workspace: sources.names.get(action.tenantId) ?? "—",
        operator: action.actorEmail,
        from: detailString(action, "previousPlanName"),
        to: detailString(action, "targetPlanName"),
      },
      date: at.toISOString(),
      to: linkTo(options, action.tenantId),
    },
  };
}

function workspaceEntry(
  workspace: ActivityWorkspace,
  options: ActivityOptions,
): ActivityEntry {
  const at = new Date(workspace.createdAt);
  return {
    kind: "lifecycle",
    at,
    item: {
      id: `workspace-${workspace._id}`,
      icon: "i-ph-buildings",
      tone: "primary",
      title: titleKey(options, "workspace_created"),
      params: { workspace: workspace.name },
      date: at.toISOString(),
      to: linkTo(options, workspace._id),
    },
  };
}

/** The feed, newest first, of the kind asked, cut at the limit. */
export function buildActivityFeed(
  sources: ActivitySources,
  options: ActivityOptions,
): ActivityFeedItem[] {
  const entries = [
    ...sources.documents.map((doc) => documentEntry(doc, sources, options)),
    ...sources.actions.map((action) => actionEntry(action, sources, options)),
    ...sources.workspaces.map((workspace) =>
      workspaceEntry(workspace, options),
    ),
  ];
  return entries
    .filter((entry): entry is ActivityEntry => entry !== null)
    .filter((entry) => options.kind === "all" || entry.kind === options.kind)
    .sort((left, right) => right.at.getTime() - left.at.getTime())
    .slice(0, options.limit)
    .map((entry) => entry.item);
}

/** The feed kind a query names, `all` when it names none it knows. */
export function parseActivityKind(value: unknown): ActivityKind {
  return ACTIVITY_KINDS.find((kind) => kind === value) ?? "all";
}
