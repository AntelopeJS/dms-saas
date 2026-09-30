import { beforeEach, describe, expect, it, vi } from "vitest";

const startDoubles = vi.hoisted(() => ({
  reconcilePlansWithStripe: vi.fn<() => Promise<void>>(),
  startPlanReconciliation: vi.fn<() => void>(),
}));

vi.mock("../src/plans/stripe-sync", () => startDoubles);
vi.mock("../src/crons", () => ({ registerSaasCrons: () => [] }));
vi.mock("../src/automation", () => ({
  registerAutomationNodes: vi.fn(),
  unregisterAutomationNodes: vi.fn(),
}));

import { start, stop } from "../src";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("module start", () => {
  // DMS registers its database schemas in its own start(), which may run
  // after this one: the plan reconciliation waits for DATABASE_INITIALIZED.
  it("leaves the Stripe plan reconciliation to the database initialized hook", async () => {
    await start();
    await stop();

    expect(startDoubles.startPlanReconciliation).not.toHaveBeenCalled();
    expect(startDoubles.reconcilePlansWithStripe).not.toHaveBeenCalled();
  });
});
