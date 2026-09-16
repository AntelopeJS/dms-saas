import type { HTTPResult } from "@antelopejs/interface-api";
import { describe, expect, it, vi } from "vitest";
import type { PlanModel, TenantSubscriptionModel } from "../src/db";
import {
  assertPriorityAllowed,
  assertSupportStatusTransition,
  getSupportAttachmentMetadata,
  parseSupportMessage,
  parseSupportTicket,
  resolveTenantSupportPolicy,
  SUPPORT_SLA_POLICIES,
  statusAfterPlatformReply,
  statusAfterTenantMessage,
  supportSlaPolicy,
} from "../src/support";

const fileStorage = vi.hoisted(() => ({
  metadata: vi.fn(),
  readUrl: vi.fn(),
}));

vi.mock("@antelopejs/interface-file-storage", async () => {
  const actual = await vi.importActual<
    typeof import("@antelopejs/interface-file-storage")
  >("@antelopejs/interface-file-storage");
  return {
    ...actual,
    GetFileMetadata: fileStorage.metadata,
    CreateReadUrl: fileStorage.readUrl,
  };
});

type Operation = () => unknown;

function expectBadRequest(operation: Operation, body: string): void {
  expect(operation).toThrowError(
    expect.objectContaining<Partial<HTTPResult>>({ status: 400, body }),
  );
}

describe("support plan policy", () => {
  it.each([
    ["community", ["normal"], null],
    ["email", ["low", "normal"], 48],
    ["priority", ["low", "normal", "high"], 8],
    ["dedicated", ["low", "normal", "high", "urgent"], 2],
  ] as const)(
    "maps %s to its priorities and SLA",
    (level, priorities, hours) => {
      expect(supportSlaPolicy(level)).toMatchObject({
        level,
        priorities,
        responseTargetHours: hours,
      });
    },
  );

  it("falls back to community when the feature is absent or invalid", () => {
    expect(supportSlaPolicy(undefined)).toBe(SUPPORT_SLA_POLICIES.community);
    expect(supportSlaPolicy("enterprise")).toBe(SUPPORT_SLA_POLICIES.community);
  });

  it("resolves an inherited support-sla plan feature", async () => {
    const subscriptions = {
      findOne: async () => ({ planId: "plan" }),
    } as TenantSubscriptionModel;
    const plans = {
      get: async () => ({ _id: "plan" }),
      resolveInheritance: async () => ({
        permissions: [],
        features: [{ featureId: "support-sla", value: "priority" }],
      }),
    } as unknown as PlanModel;
    await expect(
      resolveTenantSupportPolicy(subscriptions, plans),
    ).resolves.toBe(SUPPORT_SLA_POLICIES.priority);
  });

  it("enforces plan priority choices on the server", () => {
    expect(() =>
      assertPriorityAllowed("normal", SUPPORT_SLA_POLICIES.community),
    ).not.toThrow();
    expectBadRequest(
      () => assertPriorityAllowed("urgent", SUPPORT_SLA_POLICIES.priority),
      "saas.errors.support.priority_not_available",
    );
  });
});

describe("support input and workflow validation", () => {
  it("normalizes a valid ticket and message", () => {
    expect(
      parseSupportTicket({
        subject: "  Database issue  ",
        category: "incident",
        priority: "high",
        body: "  Please investigate  ",
        attachments: ["__staging__/first"],
      }),
    ).toEqual({
      subject: "Database issue",
      category: "incident",
      priority: "high",
      body: "Please investigate",
      attachments: ["__staging__/first"],
    });
  });

  it("only creates read URLs for promoted attachment keys", async () => {
    await expect(
      getSupportAttachmentMetadata(
        "__staging__/support-attachments/a/file",
        "support-primary",
      ),
    ).rejects.toMatchObject<Partial<HTTPResult>>({ status: 400 });
    fileStorage.metadata.mockResolvedValue({
      resourceKey: "support-attachments/a/file",
      filename: "file.txt",
      size: 10,
      mimetype: "text/plain",
    });
    fileStorage.readUrl.mockResolvedValue({ url: "https://files.test/read" });
    await expect(
      getSupportAttachmentMetadata(
        "support-attachments/a/file",
        "support-primary",
      ),
    ).resolves.toMatchObject({
      filename: "file.txt",
      url: "https://files.test/read",
    });
  });

  it.each([
    "support-attachments/tenant-a/../tenant-b/private.txt",
    "support-attachments/tenant-a\\private.txt",
  ])("rejects unsafe persisted attachment key %s", async (key) => {
    await expect(
      getSupportAttachmentMetadata(key, "support-primary"),
    ).rejects.toMatchObject<Partial<HTTPResult>>({ status: 400 });
  });

  it("rejects malformed and duplicate attachment input", () => {
    expectBadRequest(
      () => parseSupportMessage({ body: "", attachments: [] }),
      "saas.errors.support.invalid_message",
    );
    expectBadRequest(
      () => parseSupportMessage({ body: "ok", attachments: ["a", "a"] }),
      "saas.errors.support.invalid_attachments",
    );
  });

  it("enforces explicit status transitions and reply behavior", () => {
    expect(() =>
      assertSupportStatusTransition("open", "resolved"),
    ).not.toThrow();
    expectBadRequest(
      () => assertSupportStatusTransition("closed", "resolved"),
      "saas.errors.support.invalid_status_transition",
    );
    expect(statusAfterTenantMessage("closed")).toBe("open");
    expect(statusAfterTenantMessage("waiting_customer")).toBe("in_progress");
    expect(statusAfterPlatformReply("resolved")).toBe("waiting_customer");
    expectBadRequest(
      () => statusAfterPlatformReply("closed"),
      "saas.errors.support.closed_ticket_reply",
    );
  });
});
