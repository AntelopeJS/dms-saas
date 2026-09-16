import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const LEGAL_LAYOUT_PATH = new URL(
  "../frontend-vue/app/components/LegalLayout.vue",
  import.meta.url,
);

describe("LegalLayout Vue runtime", () => {
  it("loads public documents through the DMS API at browser runtime", () => {
    const source = readFileSync(LEGAL_LAYOUT_PATH, "utf8");

    expect(source).not.toContain("useFetch");
    expect(source).toContain("$fetch.create({ baseURL: dmsRuntime.baseURL })");
    expect(source).toContain("onMounted(loadDocument)");
  });
});
