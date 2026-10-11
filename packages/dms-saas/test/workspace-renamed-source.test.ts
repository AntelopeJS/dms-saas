import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = (path: string): string =>
  readFileSync(
    new URL(`../frontend-vue/app/components/${path}`, import.meta.url),
    "utf8",
  );

describe("workspace rename listeners", () => {
  // Renamed on General, the deletion still asked to type the old name, which
  // the server then refused as a mismatch.
  it("reads the danger zone's overview again after a rename", () => {
    expect(source("WorkspaceDangerZone.vue")).toContain(
      "useWorkspaceRenamed(() => void refresh())",
    );
  });

  it("reloads the switcher after a rename", () => {
    expect(source("WorkspaceSwitcherWidget.vue")).toContain(
      "useWorkspaceRenamed(() => void load())",
    );
  });
});
