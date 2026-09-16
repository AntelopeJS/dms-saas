import {
  NotificationCategory,
  NotificationSubject,
} from "@antelopejs/interface-dms/notifications";

export type NotificationSubjectInfo = ReturnType<typeof NotificationSubject>;

export const SaasCategory = NotificationCategory("saas", {
  labelKey: "saas.notifications.category.label",
  descriptionKey: "saas.notifications.category.description",
  icon: "i-ph-buildings",
  togglePermission: "default",
});

const SUBJECT_KEYS = {
  planMigrated: "saas.notifications.subjects.plan_migrated",
  trialEndingSoon: "saas.notifications.subjects.trial_ending_soon",
  trialEndedBlocked: "saas.notifications.subjects.trial_ended_blocked",
  paymentFailed: "saas.notifications.subjects.payment_failed",
  workspaceSuspended: "saas.notifications.subjects.workspace_suspended",
  subscriptionCancelled: "saas.notifications.subjects.subscription_cancelled",
  creditNoteIssued: "saas.notifications.subjects.credit_note_issued",
  refundProcessed: "saas.notifications.subjects.refund_processed",
  platformOwnerAdded: "saas.notifications.subjects.platform_owner_added",
  platformOwnerRemoved: "saas.notifications.subjects.platform_owner_removed",
  freeWorkspaceExpired: "saas.notifications.subjects.free_workspace_expired",
  freeWorkspaceEndingSoon:
    "saas.notifications.subjects.free_workspace_ending_soon",
  workspaceReactivated: "saas.notifications.subjects.workspace_reactivated",
  seatOverage: "saas.notifications.subjects.seat_overage",
  supportNewMessage: "saas.notifications.subjects.support_new_message",
  supportStatusChanged: "saas.notifications.subjects.support_status_changed",
  complimentaryAccessGranted:
    "saas.notifications.subjects.complimentary_access_granted",
  automation: "saas.notifications.subjects.automation",
} as const;

export const planMigratedSubject = NotificationSubject("saas.plan_migrated", {
  category: SaasCategory,
  labelKey: SUBJECT_KEYS.planMigrated,
  togglePermission: "default",
});
export const trialEndingSoonSubject = NotificationSubject(
  "saas.trial_ending_soon",
  {
    category: SaasCategory,
    labelKey: SUBJECT_KEYS.trialEndingSoon,
    togglePermission: "default",
  },
);
export const trialEndedBlockedSubject = NotificationSubject(
  "saas.trial_ended_blocked",
  {
    category: SaasCategory,
    labelKey: SUBJECT_KEYS.trialEndedBlocked,
    togglePermission: "forbidden",
  },
);
export const paymentFailedSubject = NotificationSubject("saas.payment_failed", {
  category: SaasCategory,
  labelKey: SUBJECT_KEYS.paymentFailed,
  togglePermission: "forbidden",
});
export const workspaceSuspendedSubject = NotificationSubject(
  "saas.workspace_suspended",
  {
    category: SaasCategory,
    labelKey: SUBJECT_KEYS.workspaceSuspended,
    togglePermission: "forbidden",
  },
);
export const freeWorkspaceExpiredSubject = NotificationSubject(
  "saas.free_workspace_expired",
  {
    category: SaasCategory,
    labelKey: SUBJECT_KEYS.freeWorkspaceExpired,
    togglePermission: "forbidden",
  },
);
export const freeWorkspaceEndingSoonSubject = NotificationSubject(
  "saas.free_workspace_ending_soon",
  {
    category: SaasCategory,
    labelKey: SUBJECT_KEYS.freeWorkspaceEndingSoon,
    togglePermission: "default",
  },
);
export const subscriptionCancelledSubject = NotificationSubject(
  "saas.subscription_cancelled",
  {
    category: SaasCategory,
    labelKey: SUBJECT_KEYS.subscriptionCancelled,
    togglePermission: "forbidden",
  },
);
export const creditNoteIssuedSubject = NotificationSubject(
  "saas.credit_note_issued",
  {
    category: SaasCategory,
    labelKey: SUBJECT_KEYS.creditNoteIssued,
    togglePermission: "default",
  },
);
export const refundProcessedSubject = NotificationSubject(
  "saas.refund_processed",
  {
    category: SaasCategory,
    labelKey: SUBJECT_KEYS.refundProcessed,
    togglePermission: "default",
  },
);
export const platformOwnerAddedSubject = NotificationSubject(
  "saas.platform_owner_added",
  {
    category: SaasCategory,
    labelKey: SUBJECT_KEYS.platformOwnerAdded,
    togglePermission: "default",
  },
);
export const platformOwnerRemovedSubject = NotificationSubject(
  "saas.platform_owner_removed",
  {
    category: SaasCategory,
    labelKey: SUBJECT_KEYS.platformOwnerRemoved,
    togglePermission: "default",
  },
);
export const workspaceReactivatedSubject = NotificationSubject(
  "saas.workspace_reactivated",
  {
    category: SaasCategory,
    labelKey: SUBJECT_KEYS.workspaceReactivated,
    togglePermission: "default",
  },
);
export const seatOverageSubject = NotificationSubject("saas.seat_overage", {
  category: SaasCategory,
  labelKey: SUBJECT_KEYS.seatOverage,
  togglePermission: "default",
});
export const supportNewMessageSubject = NotificationSubject(
  "saas.support_new_message",
  {
    category: SaasCategory,
    labelKey: SUBJECT_KEYS.supportNewMessage,
    togglePermission: "default",
  },
);
export const supportStatusChangedSubject = NotificationSubject(
  "saas.support_status_changed",
  {
    category: SaasCategory,
    labelKey: SUBJECT_KEYS.supportStatusChanged,
    togglePermission: "default",
  },
);
export const complimentaryAccessGrantedSubject = NotificationSubject(
  "saas.complimentary_access_granted",
  {
    category: SaasCategory,
    labelKey: SUBJECT_KEYS.complimentaryAccessGranted,
    togglePermission: "default",
  },
);
export const automationNotificationSubject = NotificationSubject(
  "saas.automation",
  {
    category: SaasCategory,
    labelKey: SUBJECT_KEYS.automation,
    togglePermission: "default",
  },
);
