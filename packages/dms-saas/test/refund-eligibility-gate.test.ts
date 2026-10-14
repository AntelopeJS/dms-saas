import { describe, expect, it, vi } from "vitest";

interface GuardCall {
  method: string | symbol | undefined;
  options: unknown;
}

const guards = vi.hoisted(() => ({ calls: [] as GuardCall[] }));

vi.mock("@antelopejs/interface-dms/guards", () => ({
  AuthTenantOwner:
    (options?: unknown) =>
    (_target: object, method: string | symbol | undefined) => {
      guards.calls.push({ method, options });
    },
}));

await import("../src/routes/tenant/billing-self-refund");

describe("money-back guarantee under the access gate", () => {
  // The refund cancels the subscription, which blocks the workspace: the card
  // read a 403 and told the owner to pay an unpaid invoice that did not exist.
  it("reads the eligibility of a blocked workspace", () => {
    expect(
      guards.calls.find((call) => call.method === "getRefundEligibility")
        ?.options,
    ).toEqual({ bypassTenantAccessGate: true });
  });

  it("keeps the refund itself behind the access gate", () => {
    expect(
      guards.calls.find((call) => call.method === "requestSelfRefund")?.options,
    ).toBeUndefined();
  });
});
