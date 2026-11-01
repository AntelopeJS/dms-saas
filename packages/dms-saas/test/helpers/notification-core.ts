import { ImplementInterface } from "@antelopejs/interface-core";
import * as notifications from "@antelopejs/interface-dms/notifications";
import { beforeEach, type Mock, vi } from "vitest";

/** The sends the notification core received, one fake per entry point the module reaches. */
export interface NotificationCore {
  sendToUser: Mock<typeof notifications.internal.SendToUser>;
  sendToUsers: Mock<typeof notifications.internal.SendToUsers>;
}

/**
 * Implements the DMS notification interface behind its own `internal`
 * functions, as the notification core does: recipients, content and event key
 * of every send are then observable on the returned fakes, which start clean
 * before each test. Call it at the top level of a test file.
 */
export function implementNotificationCore(): NotificationCore {
  const core: NotificationCore = {
    sendToUser: vi.fn<typeof notifications.internal.SendToUser>(),
    sendToUsers: vi.fn<typeof notifications.internal.SendToUsers>(),
  };
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
      SendToUser: core.sendToUser,
      SendToUsers: core.sendToUsers,
      SendToRoles: vi.fn(),
      SendToAll: vi.fn(),
    },
  });
  beforeEach(() => {
    core.sendToUser.mockReset();
    core.sendToUsers.mockReset();
  });
  return core;
}
