import { Logging } from "@antelopejs/interface-core/logging";
import { GetModel } from "@antelopejs/interface-database-decorators";
import { TenantMemberModel } from "@antelopejs/interface-dms/db";
import { UserModel } from "@antelopejs/interface-dms/auth/db";
import { Notification } from "@antelopejs/interface-dms/notifications";
import type { NotificationSubjectInfo } from "./subjects";

export interface SaasNotificationPayload {
  icon: string;
  title: string;
  description: string;
  linkTo?: string;
  /** Stable domain event identity; retries must preserve the notification payload. */
  eventId?: string;
}

async function sendIdempotently(
  recipients: string[],
  subject: NotificationSubjectInfo,
  payload: SaasNotificationPayload,
  eventId: string,
): Promise<void> {
  const builder = Notification()
    .icon(payload.icon)
    .title(payload.title)
    .description(payload.description)
    .subject(subject);
  if (payload.linkTo) builder.linkTo(payload.linkTo);
  await builder.build().toUsersIdempotently(recipients, eventId);
}

async function sendOne(
  userId: string,
  subject: NotificationSubjectInfo,
  payload: SaasNotificationPayload,
): Promise<void> {
  const base = Notification()
    .icon(payload.icon)
    .title(payload.title)
    .description(payload.description)
    .subject(subject);
  if (payload.linkTo) {
    await base.linkTo(payload.linkTo).build().toUser(userId);
    return;
  }
  await base.build().toUser(userId);
}

async function sendAll(
  recipients: string[],
  subject: NotificationSubjectInfo,
  payload: SaasNotificationPayload,
): Promise<void> {
  const results = await Promise.allSettled(
    recipients.map((userId) => sendOne(userId, subject, payload)),
  );
  const failures = results.flatMap((result) =>
    result.status === "rejected" ? [result.reason] : [],
  );
  if (failures.length > 0) {
    Logging.Error(
      `[dms-saas:notifications] ${failures.length} delivery attempt(s) failed`,
      new AggregateError(failures),
    );
  }
}

type RecipientResolver = () => Promise<string[]>;

async function deliverNotification(
  resolveRecipients: RecipientResolver,
  subject: NotificationSubjectInfo,
  payload: SaasNotificationPayload,
): Promise<void> {
  if (payload.eventId !== undefined) {
    await sendIdempotently(
      await resolveRecipients(),
      subject,
      payload,
      payload.eventId,
    );
    return;
  }
  try {
    await sendAll(await resolveRecipients(), subject, payload);
  } catch (error) {
    Logging.Error(
      "[dms-saas:notifications] recipient resolution failed",
      error,
    );
  }
}

export async function resolveTenantMemberRecipients(
  tenantId: string,
): Promise<string[]> {
  const memberModel = GetModel(TenantMemberModel, tenantId);
  const members = await memberModel.listAll();
  return members.map((m) => m.userId);
}

export async function resolveTenantOwners(tenantId: string): Promise<string[]> {
  const memberModel = GetModel(TenantMemberModel, tenantId);
  const owners = await memberModel.listOwners();
  return owners.map((m) => m.userId);
}

/**
 * Eventful delivery rejects failures so domain work can retry until persisted.
 * Core deduplicates durable recipient rows; realtime publication is best-effort
 * and may be missed after a crash between persistence and publication.
 */
export async function notifyTenantMembers(
  tenantId: string,
  subject: NotificationSubjectInfo,
  payload: SaasNotificationPayload,
): Promise<void> {
  await deliverNotification(
    () => resolveTenantMemberRecipients(tenantId),
    subject,
    payload,
  );
}

/** Delivers to owners with the same durable-event contract as notifyTenantMembers. */
export async function notifyTenantOwners(
  tenantId: string,
  subject: NotificationSubjectInfo,
  payload: SaasNotificationPayload,
): Promise<void> {
  await deliverNotification(
    () => resolveTenantOwners(tenantId),
    subject,
    payload,
  );
}

export async function resolvePlatformOwners(
  excludeUserId?: string,
): Promise<string[]> {
  const userModel = GetModel(UserModel);
  const rows = await userModel.table
    .filter((user) => user.key("owner").eq(true))
    .run();
  const ids: string[] = [];
  for (const row of rows) {
    const user = UserModel.fromDatabase(row);
    if (user && user._id !== excludeUserId) ids.push(user._id);
  }
  return ids;
}

export async function notifyAllPlatformOwners(
  subject: NotificationSubjectInfo,
  payload: SaasNotificationPayload,
  excludeUserId?: string,
): Promise<void> {
  await deliverNotification(
    () => resolvePlatformOwners(excludeUserId),
    subject,
    payload,
  );
}
