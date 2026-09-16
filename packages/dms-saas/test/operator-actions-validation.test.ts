import { HTTPResult } from "@antelopejs/interface-api";
import { describe, expect, it } from "vitest";
import type { Plan } from "../src/db";
import {
  isEligibleManualUpgradeTarget,
  validateBalanceCreditInput,
} from "../src/operator-actions/commands";
import { assertOperationId } from "../src/operator-actions/journal";

type Operation = () => void;

interface EligibilityCase {
  name: string;
  patch: Partial<Plan>;
}

const CURRENT_PLAN_ID = "current-plan";
const TARGET_PLAN_ID = "target-plan";

function plan(id: string, price: number): Plan {
  return {
    _id: id,
    name: id,
    audience: "any",
    price,
    currency: "eur",
    interval: "month",
    maxMembers: 10,
    paymentProviderRefs: { stripePriceId: `price_${id}` },
    isActive: true,
    isDeleted: false,
  } as Plan;
}

function expectError(operation: Operation, code: string): void {
  const error = (() => {
    try {
      operation();
      return null;
    } catch (caught) {
      return caught;
    }
  })();
  expect(error).toBeInstanceOf(HTTPResult);
  expect(error).toMatchObject({ status: 400, body: code });
}

describe("operator action validation", () => {
  it("accepts stable operation identifiers", () => {
    expect(() => assertOperationId("operator-12345678")).not.toThrow();
  });

  it.each(["", "short", "contains spaces", "x".repeat(65)])(
    "rejects invalid operation identifier %s",
    (operationId) => {
      expectError(
        () => assertOperationId(operationId),
        "saas.errors.operator.invalid_operation_id",
      );
    },
  );

  it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    "rejects invalid credit amount %s",
    (amountCents) => {
      expectError(
        () => validateBalanceCreditInput(amountCents, "Service recovery"),
        "saas.errors.operator.invalid_credit_amount",
      );
    },
  );

  it.each(["", "   ", "x".repeat(501)])(
    "rejects invalid credit reasons",
    (reason) => {
      expectError(
        () => validateBalanceCreditInput(500, reason),
        "saas.errors.operator.invalid_credit_reason",
      );
    },
  );
});

describe("manual upgrade eligibility", () => {
  const current = plan(CURRENT_PLAN_ID, 10);

  it("accepts an active Stripe-backed upgrade for the audience and seat count", () => {
    expect(
      isEligibleManualUpgradeTarget(
        plan(TARGET_PLAN_ID, 20),
        current,
        "individual",
        5,
      ),
    ).toBe(true);
  });

  const ineligibleCases: EligibilityCase[] = [
    { name: "inactive", patch: { isActive: false } },
    { name: "deleted", patch: { isDeleted: true } },
    { name: "wrong audience", patch: { audience: "business" } },
    { name: "free", patch: { price: 0 } },
    {
      name: "not synchronized with Stripe",
      patch: { paymentProviderRefs: {} },
    },
    { name: "over its seat limit", patch: { maxMembers: 4 } },
    { name: "a downgrade", patch: { price: 5 } },
    { name: "the current plan", patch: { _id: CURRENT_PLAN_ID } },
  ];

  it.each(ineligibleCases)("rejects $name plans", ({ patch }) => {
    const target = { ...plan(TARGET_PLAN_ID, 20), ...patch } as Plan;
    expect(
      isEligibleManualUpgradeTarget(target, current, "individual", 5),
    ).toBe(false);
  });

  it("rejects a plan when the customer audience is unknown", () => {
    expect(
      isEligibleManualUpgradeTarget(plan(TARGET_PLAN_ID, 20), current, null, 5),
    ).toBe(false);
  });

  it("normalizes annual pricing when enforcing upgrade-only behavior", () => {
    const annual = {
      ...plan(TARGET_PLAN_ID, 100),
      interval: "year",
    } as Plan;
    expect(
      isEligibleManualUpgradeTarget(annual, current, "individual", 5),
    ).toBe(false);
  });
});
