import { assert } from "@antelopejs/interface-api-util";
import type {
  PlanModel,
  SupportTicketPriority,
  TenantSubscriptionModel,
} from "../db";

export const SUPPORT_SLA_FEATURE_ID = "support-sla";
export const SUPPORT_ATTACHMENT_PATH = "support-attachments";
export const SUPPORT_ATTACHMENT_LIMIT = 5;
export const SUPPORT_ATTACHMENT_MAX_SIZE = 10 * 1024 * 1024;
export const SUPPORT_ATTACHMENT_MIMETYPES = [
  "image/*",
  "application/pdf",
  "text/plain",
] as const;

export const SUPPORT_SLA_LEVELS = [
  "community",
  "email",
  "priority",
  "dedicated",
] as const;
export type SupportSlaLevel = (typeof SUPPORT_SLA_LEVELS)[number];

export interface SupportSlaPolicy {
  level: SupportSlaLevel;
  responseTargetHours: number | null;
  businessHoursOnly: boolean;
  priorities: SupportTicketPriority[];
}

const HTTP_BAD_REQUEST = 400;
const VALID_SLA_LEVELS = new Set<string>(SUPPORT_SLA_LEVELS);

export function tenantSupportAttachmentPath(tenantId: string): string {
  return `${SUPPORT_ATTACHMENT_PATH}/${tenantId}`;
}

export const SUPPORT_SLA_POLICIES: Record<SupportSlaLevel, SupportSlaPolicy> = {
  community: {
    level: "community",
    responseTargetHours: null,
    businessHoursOnly: false,
    priorities: ["normal"],
  },
  email: {
    level: "email",
    responseTargetHours: 48,
    businessHoursOnly: true,
    priorities: ["low", "normal"],
  },
  priority: {
    level: "priority",
    responseTargetHours: 8,
    businessHoursOnly: true,
    priorities: ["low", "normal", "high"],
  },
  dedicated: {
    level: "dedicated",
    responseTargetHours: 2,
    businessHoursOnly: false,
    priorities: ["low", "normal", "high", "urgent"],
  },
};

export function supportSlaPolicy(value: unknown): SupportSlaPolicy {
  const level =
    typeof value === "string" && VALID_SLA_LEVELS.has(value)
      ? (value as SupportSlaLevel)
      : "community";
  return SUPPORT_SLA_POLICIES[level];
}

export function assertPriorityAllowed(
  priority: SupportTicketPriority,
  policy: SupportSlaPolicy,
): void {
  assert(
    policy.priorities.includes(priority),
    HTTP_BAD_REQUEST,
    "saas.errors.support.priority_not_available",
  );
}

export async function resolveTenantSupportPolicy(
  subscriptions: TenantSubscriptionModel,
  plans: PlanModel,
): Promise<SupportSlaPolicy> {
  const subscription = await subscriptions.findOne();
  if (!subscription?.planId) return SUPPORT_SLA_POLICIES.community;
  const plan = await plans.get(subscription.planId);
  if (!plan) return SUPPORT_SLA_POLICIES.community;
  const inherited = await plans.resolveInheritance(plan);
  const feature = inherited.features.find(
    (candidate) => candidate.featureId === SUPPORT_SLA_FEATURE_ID,
  );
  return supportSlaPolicy(feature?.value);
}
