import { GetModel } from "@antelopejs/interface-database-decorators";
import {
  type LayoutBannerComponentInfo,
  type LayoutBannerContext,
  LayoutBannerVariant,
  RegisterLayoutBanner,
} from "@antelopejs/interface-dms/layout-banners";
import { TenantSubscriptionModel } from "../db";
import { MS_PER_DAY } from "../utils/time";
import { isWorkspaceOwnerRequest } from "./past-due-banner";

const TRIALING_STATUS = "trialing";
const BANNER_COMPONENT = "DmsSaasTrialEndingBanner";

/**
 * The owner is reminded 7, 3 and 1 day before the trial ends: one banner per
 * reminder, so dismissing one does not silence the next. The last stays.
 */
interface TrialReminder {
  key: string;
  /** Shown while at most this many days are left… */
  maxDaysLeft: number;
  /** …and more than this many. */
  minDaysLeftExclusive: number;
  dismissible: boolean;
}

const TRIAL_REMINDERS: TrialReminder[] = [
  {
    key: "dms-saas:trial-ending-7",
    maxDaysLeft: 7,
    minDaysLeftExclusive: 3,
    dismissible: true,
  },
  {
    key: "dms-saas:trial-ending-3",
    maxDaysLeft: 3,
    minDaysLeftExclusive: 1,
    dismissible: true,
  },
  {
    key: "dms-saas:trial-ending-1",
    maxDaysLeft: 1,
    minDaysLeftExclusive: 0,
    dismissible: false,
  },
];

/** Whole days until the trial ends, counting a started day as one. */
export function trialDaysLeft(trialEndsAt: Date, now: Date): number {
  return Math.ceil((trialEndsAt.getTime() - now.getTime()) / MS_PER_DAY);
}

async function readTrialDaysLeft(tenantId: string): Promise<number | null> {
  const subscription = await GetModel(
    TenantSubscriptionModel,
    tenantId,
  ).findOne();
  if (subscription?.status !== TRIALING_STATUS) return null;
  if (!subscription.currentPeriodEnd) return null;
  return trialDaysLeft(new Date(subscription.currentPeriodEnd), new Date());
}

function isInWindow(reminder: TrialReminder, daysLeft: number): boolean {
  return (
    daysLeft <= reminder.maxDaysLeft && daysLeft > reminder.minDaysLeftExclusive
  );
}

/** Whether one reminder shows: to an owner, in its window of the trial. */
function trialReminderVisibility(reminder: TrialReminder) {
  return async (context: LayoutBannerContext): Promise<boolean> => {
    if (!(await isWorkspaceOwnerRequest(context))) return false;
    const daysLeft = await readTrialDaysLeft(context.tenantId);
    return daysLeft !== null && isInWindow(reminder, daysLeft);
  };
}

/** The three reminders, as layout banners. */
export const TRIAL_ENDING_BANNERS: LayoutBannerComponentInfo[] =
  TRIAL_REMINDERS.map((reminder) => ({
    key: reminder.key,
    variant: LayoutBannerVariant.INFO,
    icon: "i-ph-hourglass-medium",
    dismissible: reminder.dismissible,
    component: BANNER_COMPONENT,
    visible: trialReminderVisibility(reminder),
  }));

export function registerTrialEndingBanners(): void {
  TRIAL_ENDING_BANNERS.forEach((banner) => RegisterLayoutBanner(banner));
}
