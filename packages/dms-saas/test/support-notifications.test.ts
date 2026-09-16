import { beforeEach, describe, expect, it, vi } from "vitest";

const notification = vi.hoisted(() => ({
  error: vi.fn(),
  send: vi.fn(),
}));

vi.mock("@antelopejs/interface-core/logging", () => ({
  Logging: { Error: notification.error },
}));

vi.mock("@antelopejs/interface-database-decorators", () => ({
  GetModel: () => ({
    listAll: async () => [{ userId: "first" }, { userId: "second" }],
  }),
}));

vi.mock("@antelopejs/interface-dms/notifications", () => {
  class NotificationBuilder {
    icon(): this {
      return this;
    }

    title(): this {
      return this;
    }

    description(): this {
      return this;
    }

    subject(): this {
      return this;
    }

    linkTo(): this {
      return this;
    }

    build(): this {
      return this;
    }

    async toUser(userId: string): Promise<void> {
      await notification.send(userId);
    }
  }

  return { Notification: () => new NotificationBuilder() };
});

import { notifyTenantMembers } from "../src/notifications/recipients";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("support notification delivery", () => {
  it("attempts every recipient and does not fail a committed mutation", async () => {
    notification.send.mockRejectedValueOnce(new Error("delivery failed"));

    await expect(
      notifyTenantMembers("tenant-a", {} as never, {
        icon: "i-ph-lifebuoy",
        title: "Support reply",
        description: "A new reply is available.",
      }),
    ).resolves.toBeUndefined();

    expect(notification.send).toHaveBeenCalledTimes(2);
    expect(notification.send).toHaveBeenCalledWith("second");
    expect(notification.error).toHaveBeenCalledOnce();
  });
});
