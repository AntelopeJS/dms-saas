import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sendSupportRequest } from "../frontend-vue/app/composables/useSupportRequest";

const stored = new Map<string, string>();
beforeEach(() => {
  stored.clear();
  vi.stubGlobal("sessionStorage", {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => stored.set(key, value),
    removeItem: (key: string) => stored.delete(key),
  });
});
afterEach(() => vi.unstubAllGlobals());

describe("support transport identity", () => {
  it("retains identity after ambiguity and refuses changed content", async () => {
    const send = vi
      .fn()
      .mockRejectedValueOnce(new Error("lost response"))
      .mockResolvedValue("ok");
    await expect(
      sendSupportRequest("tenant:create", { body: "private text" }, send),
    ).rejects.toThrow("lost response");
    expect([...stored.values()].join()).not.toContain("private text");
    await expect(
      sendSupportRequest("tenant:create", { body: "different" }, send),
    ).rejects.toThrow("unchanged");
    await sendSupportRequest("tenant:create", { body: "private text" }, send);
    expect(send.mock.calls[0][0].requestId).toBe(
      send.mock.calls[1][0].requestId,
    );
    expect(stored.size).toBe(0);
  });

  it("does not let a delayed duplicate response clear a newer pending request", async () => {
    const delayed = Promise.withResolvers<string>();
    const entered = Promise.withResolvers<void>();
    const first = sendSupportRequest("scope", { body: "first" }, async () => {
      entered.resolve();
      return delayed.promise;
    });
    await entered.promise;
    await sendSupportRequest("scope", { body: "first" }, async () => "success");
    await expect(
      sendSupportRequest("scope", { body: "second" }, async () => {
        throw new Error("unknown");
      }),
    ).rejects.toThrow("unknown");
    const pending = [...stored.values()];
    delayed.resolve("old success");
    await first;
    expect([...stored.values()]).toEqual(pending);
  });
});
