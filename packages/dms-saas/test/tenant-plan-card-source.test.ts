import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const CARD_PATH = new URL(
  "../frontend-vue/app/components/TenantPlanCard.vue",
  import.meta.url,
);

describe("TenantPlanCard", () => {
  // The switcher names the current plan: after an upgrade it kept the old one
  // until the next page load.
  it("reloads the switcher's workspaces once the plan changed", () => {
    const source = readFileSync(CARD_PATH, "utf8");
    const refresh = source.slice(source.indexOf("async function refresh()"));

    expect(source).toContain("const myWorkspaces = useMyWorkspaces()");
    expect(refresh.slice(0, refresh.indexOf("\n}\n"))).toContain(
      "myWorkspaces.refresh()",
    );
  });

  // "Complete payment" on the access-restricted screen sends the owner of a
  // workspace waiting for payment to `?upgrade=<its plan>`: it opened Compare,
  // with the plan they had to pay for marked as the current one.
  it("opens the payment of the workspace's own plan when it pays anew", () => {
    const source = readFileSync(CARD_PATH, "utf8");
    const consume = source.slice(
      source.indexOf("async function consumeUpgradeParam()"),
    );

    expect(consume).toContain(
      "canResubscribe.value || !!data.value.canRecoverComplimentary",
    );
    expect(consume).toMatch(
      /plan\._id === current\.value\?\._id && !isChoosingAnew/,
    );
  });
});

const SUSPENDED_PATH = new URL(
  "../frontend-vue/app/components/WorkspaceSuspended.vue",
  import.meta.url,
);

describe("WorkspaceSuspended", () => {
  it("links Complete payment to the payment of the workspace's plan", () => {
    const source = readFileSync(SUSPENDED_PATH, "utf8");

    expect(source).toMatch(
      /reason\.value === PENDING_PAYMENT_REASON && planId\)\s+return billingUpgradePath\(planId\)/,
    );
  });
});
