import { ImplementInterface } from "@antelopejs/interface-core";
import * as notifications from "@antelopejs/interface-dms/notifications";
import { type Mock, vi } from "vitest";

/** What the DMS notifications module was asked to deliver. */
export interface ImplementedNotifications {
  /** Deliveries to one user, one call per recipient. */
  sendToUser: Mock<typeof notifications.internal.SendToUser>;
  /** Deliveries to several users at once, keyed by their event identity. */
  sendToUsers: Mock<typeof notifications.internal.SendToUsers>;
}

/**
 * Implements the DMS notifications module behind
 * `@antelopejs/interface-dms/notifications` with observers of what it is asked
 * to deliver; categories and subjects register into nothing and the module
 * claims to deduplicate by event identity. Call it at the top level of a test
 * file and `mockClear` the observers between tests.
 */
export function implementNotifications(): ImplementedNotifications {
  const sendToUser = vi.fn<typeof notifications.internal.SendToUser>();
  const sendToUsers = vi.fn<typeof notifications.internal.SendToUsers>();
  ImplementInterface(notifications, {
    internal: {
      SupportsIdempotency: async () => true,
      RegisterNotificationCategory: {
        register: () => undefined,
        unregister: () => undefined,
      },
      RegisterNotificationSubject: {
        register: () => undefined,
        unregister: () => undefined,
      },
      SendToUser: sendToUser,
      SendToUsers: sendToUsers,
      SendToRoles: vi.fn(),
      SendToAll: vi.fn(),
    },
  });
  return { sendToUser, sendToUsers };
}
