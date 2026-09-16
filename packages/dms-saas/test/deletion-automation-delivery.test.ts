import { setImmediate } from "node:timers/promises";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TriggerType } from "@antelopejs/interface-dms-automation";

const registration = vi.hoisted(() => vi.fn());
vi.mock("@antelopejs/interface-dms-automation", () => ({
  RegisterTriggerType: registration,
  RegisterActionType: vi.fn(),
  UnregisterTriggerType: vi.fn(),
  UnregisterActionType: vi.fn(),
}));
vi.mock("../src/notifications", () => ({
  notifyTenantOwners: vi.fn(),
  automationNotificationSubject: {},
}));
vi.mock("../src/operator-actions", () => ({
  reactivateWorkspaceCommand: vi.fn(),
  suspendWorkspaceCommand: vi.fn(),
}));

import {
  emitAutomationEvent,
  emitTenantDeletedEvent,
  registerAutomationNodes,
} from "../src/automation";

beforeEach(() => registration.mockClear());

describe("best-effort automation emission", () => {
  it("contains synchronous and asynchronous listener failures without skipping later listeners", async () => {
    registerAutomationNodes();
    const trigger = registration.mock.calls
      .map(([item]) => item as TriggerType)
      .find((item) => item.id === "saas.trial-ending")!;
    const synchronousFailure = vi.fn(() => {
      throw new Error("synchronous listener failure");
    });
    const asynchronousFailure = () =>
      Promise.reject(new Error("queue unavailable"));
    const delivered = vi.fn();
    const handles = await Promise.all(
      [synchronousFailure, asynchronousFailure, delivered].map((listener) =>
        trigger.activate({}, listener),
      ),
    );
    const payload = {
      tenantId: "tenant-a",
      trialEndsAt: null,
      at: "2026-09-14T00:00:00Z",
    };
    try {
      expect(() =>
        emitAutomationEvent("saas.trial-ending", payload),
      ).not.toThrow();
      await setImmediate();
      expect(delivered).toHaveBeenCalledExactlyOnceWith(payload);
    } finally {
      await Promise.all(handles.map((handle) => trigger.deactivate(handle)));
    }
  });
});

describe("replayable deletion automation emission", () => {
  it("propagates asynchronous failure and forwards the same operation identity on retry", async () => {
    registerAutomationNodes();
    const trigger = registration.mock.calls
      .map(([item]) => item as TriggerType)
      .find((item) => item.id === "saas.tenant-deleted")!;
    const emit = vi
      .fn()
      .mockRejectedValueOnce(new Error("queue unavailable"))
      .mockResolvedValue(undefined);
    const handle = await trigger.activate({}, emit);
    const payload = {
      tenantId: "tenant-a",
      operationId: "delete-operation-a",
      at: "2026-09-14T00:00:00Z",
    };
    try {
      await expect(emitTenantDeletedEvent(payload)).rejects.toThrow(
        "queue unavailable",
      );
      await emitTenantDeletedEvent(payload);
      expect(emit).toHaveBeenCalledTimes(2);
      expect(emit).toHaveBeenNthCalledWith(1, payload);
      expect(emit).toHaveBeenNthCalledWith(2, payload);
    } finally {
      await trigger.deactivate(handle);
    }
  });
});
