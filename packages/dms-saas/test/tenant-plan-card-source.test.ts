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
});
