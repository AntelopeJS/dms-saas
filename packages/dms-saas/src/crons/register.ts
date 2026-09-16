import type { ScheduledTask } from "node-cron";
import { scheduleAutoSuspendPastDue } from "./auto-suspend-past-due";
import { scheduleCleanupStripeWebhookEvents } from "./cleanup-stripe-webhook-events";
import { scheduleExpireFreeWorkspaces } from "./expire-free-workspaces";
import { scheduleHardDeleteCancelled } from "./hard-delete-cancelled";
import { scheduleNotifyFreeWorkspacesEndingSoon } from "./notify-free-workspaces-ending-soon";
import { scheduleRecomputeBillingState } from "./recompute-billing-state";
import { scheduleRecomputeSegments } from "./recompute-segments";
import { scheduleReconcileWorkspaceLifecycle } from "./reconcile-workspace-lifecycle";

export function registerSaasCrons(): ScheduledTask[] {
  return [
    scheduleAutoSuspendPastDue(),
    scheduleExpireFreeWorkspaces(),
    scheduleNotifyFreeWorkspacesEndingSoon(),
    scheduleHardDeleteCancelled(),
    scheduleCleanupStripeWebhookEvents(),
    scheduleRecomputeSegments(),
    scheduleRecomputeBillingState(),
    scheduleReconcileWorkspaceLifecycle(),
  ];
}
