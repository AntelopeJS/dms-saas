import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const DATA_EXPORT_PATH = new URL(
  "../frontend-vue/app/components/DataExport.vue",
  import.meta.url,
);

describe("DataExport polling", () => {
  // The status route of DMS 0.7.5 never answers: a read every two seconds
  // held every connection the browser opens to the host within seconds.
  it("reads one status at a time", () => {
    const source = readFileSync(DATA_EXPORT_PATH, "utf8");
    const read = source.slice(
      source.indexOf("async function readRunningStatus"),
    );

    expect(read).toMatch(/if \(isReadingStatus\) return null/);
    expect(read).toMatch(/finally \{\s+isReadingStatus = false/);
    expect(source).toContain("await readRunningStatus(entry.jobId)");
  });
});
