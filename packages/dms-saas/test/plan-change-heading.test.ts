import { describe, expect, it } from "vitest";
import {
  checkoutHeadingCase,
  planChangeHeadingCase,
} from "../frontend-vue/app/build/plan-change-heading";

const STARTER = { price: 29, interval: "month", billingMode: "flat" };
const PRO = { price: 49, interval: "month", billingMode: "flat" };

function priced(kind: string, isTrial = false) {
  return { kind, isTrial };
}

describe("plan change review heading", () => {
  it.each([
    ["an upgrade paid now", priced("upgrade"), STARTER, PRO, "upgrade"],
    [
      "a plan at the same price",
      priced("upgrade"),
      STARTER,
      { ...STARTER },
      "same_price",
    ],
    [
      "the same price billed yearly",
      priced("upgrade"),
      STARTER,
      { ...STARTER, interval: "year" },
      "upgrade",
    ],
    ["a change during a trial", priced("upgrade", true), STARTER, PRO, "trial"],
    ["a downgrade", priced("downgrade"), PRO, STARTER, "downgrade"],
    ["a free plan", priced("free"), PRO, { ...STARTER, price: 0 }, "free"],
    ["a change not priced yet", null, STARTER, PRO, "upgrade"],
  ])("titles %s as %s", (_case, change, current, target, expected) => {
    expect(planChangeHeadingCase(change, current, target)).toBe(expected);
  });
});

describe("first paid plan checkout heading", () => {
  it.each([
    [true, false, "resubscribe"],
    [true, true, "resubscribe"],
    [false, true, "trial"],
    [false, false, "upgrade"],
  ])(
    "titles a resubscription %s with a trial %s as %s",
    (isResubscription, isTrial, expected) => {
      expect(checkoutHeadingCase(isResubscription, isTrial)).toBe(expected);
    },
  );
});
