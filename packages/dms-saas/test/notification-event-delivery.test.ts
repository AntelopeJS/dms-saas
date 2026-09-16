import { beforeEach, describe, expect, it, vi } from "vitest";

const dependencies = vi.hoisted(() => ({
  members: vi.fn(),
  owners: vi.fn(),
  deliver: vi.fn(),
  legacy: vi.fn(),
  link: vi.fn(),
}));

vi.mock("@antelopejs/interface-database-decorators", () => ({
  GetModel: () => ({
    listAll: dependencies.members,
    listOwners: dependencies.owners,
  }),
}));

vi.mock("@antelopejs/interface-dms/notifications", async () => {
  class Builder {
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
    linkTo(path: string): this {
      dependencies.link(path);
      return this;
    }
    build() {
      return {
        toUsersIdempotently: dependencies.deliver,
        toUser: dependencies.legacy,
      };
    }
  }
  return {
    ...(await vi.importActual("@antelopejs/interface-dms/notifications")),
    Notification: () => new Builder(),
  };
});

import {
  notifyTenantMembers,
  notifyTenantOwners,
} from "../src/notifications/recipients";
import { freeWorkspaceExpiredSubject } from "../src/notifications/subjects";

const payload = {
  eventId: "expiry:subscription-a:2026-09-10",
  icon: "i-ph-hourglass",
  title: "Expired",
  description: "Complimentary access expired.",
  linkTo: "/billing",
};

beforeEach(() => {
  vi.resetAllMocks();
  dependencies.members.mockResolvedValue([
    { userId: "member-a" },
    { userId: "member-b" },
  ]);
  dependencies.owners.mockResolvedValue([{ userId: "owner-c" }]);
});

describe("durable notification event forwarding", () => {
  it("forwards overlapping deliveries with the same event identity to core", async () => {
    await Promise.all([
      notifyTenantMembers("tenant-a", freeWorkspaceExpiredSubject, payload),
      notifyTenantMembers("tenant-a", freeWorkspaceExpiredSubject, payload),
    ]);
    expect(dependencies.deliver).toHaveBeenCalledTimes(2);
    expect(dependencies.deliver).toHaveBeenNthCalledWith(
      1,
      ["member-a", "member-b"],
      payload.eventId,
    );
    expect(dependencies.deliver).toHaveBeenNthCalledWith(
      2,
      ["member-a", "member-b"],
      payload.eventId,
    );
    expect(dependencies.legacy).not.toHaveBeenCalled();
    expect(dependencies.link).toHaveBeenCalledWith("/billing");
  });

  it("propagates partial delivery failure and retries the full recipient set", async () => {
    const error = new Error("second recipient unavailable");
    dependencies.deliver.mockRejectedValueOnce(error);
    await expect(
      notifyTenantMembers("tenant-a", freeWorkspaceExpiredSubject, payload),
    ).rejects.toBe(error);
    await notifyTenantMembers("tenant-a", freeWorkspaceExpiredSubject, payload);
    expect(dependencies.deliver).toHaveBeenNthCalledWith(
      2,
      ["member-a", "member-b"],
      payload.eventId,
    );
  });

  it("propagates recipient resolution failure without consuming the event", async () => {
    const error = new Error("owners unavailable");
    dependencies.owners.mockRejectedValueOnce(error);
    await expect(
      notifyTenantOwners("tenant-a", freeWorkspaceExpiredSubject, payload),
    ).rejects.toBe(error);
    expect(dependencies.deliver).not.toHaveBeenCalled();
    await notifyTenantOwners("tenant-a", freeWorkspaceExpiredSubject, payload);
    expect(dependencies.deliver).toHaveBeenCalledWith(
      ["owner-c"],
      payload.eventId,
    );
  });
});
