import type {
  ComposedText,
  ComposedTextParam,
  StatGroupItem,
} from "@antelopejs/interface-dms/base";
import {
  composed,
  countParam,
  dateParam,
  dotList,
  moneyParam,
} from "../i18n/composed-text";
import { STATUS_TONES } from "../utils/status-vocabulary";
import type {
  WorkspaceOverview,
  WorkspacePlanOverview,
} from "./workspace-overview";

const KEYS = "saas.workspace.general.glance";
const PRICE_KEYS = "saas.workspace.plan_price";
const MEMBERS_PATH = "/settings/workspace/members";
const BILLING_PATH = "/settings/workspace/billing";
const HEALTHY_TONE = "success";
const MINOR_UNITS_PER_UNIT = 100;
const NO_VALUE = "—";

function membersItem({ seats }: WorkspaceOverview): StatGroupItem {
  const occupied = seats.occupied;
  return {
    id: "members",
    icon: "i-ph-users-three",
    eyebrow: `$${KEYS}.members`,
    value:
      seats.maxMembers === null
        ? composed(`${KEYS}.seats_unlimited`, { occupied })
        : composed(`${KEYS}.seats_of`, { occupied, max: seats.maxMembers }),
    detail: composed(`${KEYS}.seats_detail`, {
      members: composed(`${KEYS}.members_count`, {
        count: countParam(seats.members),
      }),
      invites: composed(`${KEYS}.invites_count`, {
        count: countParam(seats.pendingInvites),
      }),
    }),
    to: MEMBERS_PATH,
  };
}

/** "€49.00 / seat / month", "€29.00 / month", or "Free". */
function priceLabel(plan: WorkspacePlanOverview): ComposedText {
  if (plan.price <= 0) return composed(`${PRICE_KEYS}.free`);
  return composed(`${PRICE_KEYS}.${plan.billingMode}_${plan.interval}`, {
    price: moneyParam(
      Math.round(plan.price * MINOR_UNITS_PER_UNIT),
      plan.currency,
    ),
  });
}

function planDetail(plan: WorkspacePlanOverview): ComposedText | null {
  const parts: ComposedTextParam[] = [
    composed(`saas.status.workspace.${plan.status}`),
    plan.isComplimentary ? composed(`${KEYS}.complimentary`) : priceLabel(plan),
  ];
  if (plan.renewsAt) {
    parts.push(composed(`${KEYS}.renews`, { date: dateParam(plan.renewsAt) }));
  }
  return dotList(parts);
}

function planItem({ plan }: WorkspaceOverview): StatGroupItem {
  const tone = plan ? STATUS_TONES.workspace[plan.status] : "neutral";
  return {
    id: "plan",
    icon: "i-ph-stack",
    eyebrow: `$${KEYS}.plan`,
    value: plan?.name ?? `$${KEYS}.no_plan`,
    detail: plan ? (planDetail(plan) ?? undefined) : undefined,
    detailTone: tone === HEALTHY_TONE ? undefined : tone,
    to: BILLING_PATH,
  };
}

function ownerItem(view: WorkspaceOverview): StatGroupItem {
  const [first, ...others] = view.owners;
  const created = composed(`${KEYS}.created`, {
    name: view.name,
    date: dateParam(view.createdAt),
  });
  const lead = first?.isCaller
    ? dotList([composed(`${KEYS}.you`), created])
    : created;
  const name = first?.name ?? NO_VALUE;
  return {
    id: "owner",
    icon: "i-ph-crown-simple",
    eyebrow: `$${KEYS}.owner`,
    value: others.length
      ? composed(`${KEYS}.owner_and_others`, {
          name,
          others: composed(`${KEYS}.more_owners`, {
            count: countParam(others.length),
          }),
        })
      : name,
    detail: lead ?? undefined,
    to: MEMBERS_PATH,
  };
}

/**
 * The General page's "At a glance" cards: who is in the workspace, what it
 * pays, who owns it. Each links to where it is managed.
 *
 * @param view The workspace overview, for one of its owners
 */
export function workspaceGlanceItems(view: WorkspaceOverview): StatGroupItem[] {
  return [membersItem(view), planItem(view), ownerItem(view)];
}
