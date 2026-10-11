import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const MODAL_PATH = new URL(
  "../frontend-vue/app/components/PlanUpgradeModal.vue",
  import.meta.url,
);

describe("PlanUpgradeModal", () => {
  // `?upgrade=<planId>` opens the dialog before the owner check mounts it: a
  // lazy watcher never saw it open and left the billing identity blank.
  it("reads the billing identity when it mounts already open", () => {
    const source = readFileSync(MODAL_PATH, "utf8");
    const watcher = source.slice(source.indexOf("watch(\n\topen,"));

    expect(watcher).toMatch(
      /^watch\(\n\topen,[\s\S]*?loadIdentity\(\)[\s\S]*?\{ immediate: true \},\n\)/,
    );
  });
});
