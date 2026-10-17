import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// A plan's description and badge follow the DMS display string convention:
// a stored `$key` is translated. A template printing them as stored shows the
// key itself to the operator or the visitor.

const APP_DIR = new URL("../frontend-vue/app/", import.meta.url);
/**
 * A plan's badge or description printed as stored: `{{ plan.borderLabel }}`,
 * `:label="plan.borderLabel"`.
 */
const RAW_DISPLAY =
  /(?:\{\{\s*|:(?:label|text|title|description)="\s*)[\w?.]*\.(?:borderLabel|description)\s*(?:\}\}|")/g;

function vueFiles(): string[] {
  return readdirSync(APP_DIR, { recursive: true, encoding: "utf8" })
    .filter((path) => path.endsWith(".vue"))
    .map((path) => path.replaceAll("\\", "/"));
}

function rawPlanDisplays(path: string): string[] {
  const source = readFileSync(new URL(path, APP_DIR), "utf8");
  return [...source.matchAll(RAW_DISPLAY)]
    .map((match) => match[0])
    .filter((match) => /\b(plan|draft)\b/.test(match));
}

describe("plan display strings", () => {
  it("are translated wherever a plan's badge or description is shown", () => {
    const raw = vueFiles().flatMap((path) =>
      rawPlanDisplays(path).map((match) => `${path}: ${match}`),
    );
    expect(raw).toEqual([]);
  });
});
