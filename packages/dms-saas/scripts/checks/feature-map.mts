import { spawnSync } from "node:child_process";
import { join } from "node:path";

const WORKSPACE_ROOT = join(import.meta.dirname, "..", "..", "..", "..");
const DMS_CONTROL = join(
  WORKSPACE_ROOT,
  "node_modules",
  "@antelopejs",
  "dms",
  "bin",
  "dms-control.mjs",
);

/**
 * The verify skill's feature map, as `dms-control map` checks it: every
 * tracked user-facing file is in a feature's `covers:` globs, and every
 * feature has its journeys and existing docs pages.
 *
 * @returns One line per finding `dms-control map` prints
 */
export function featureMapFailures(): string[] {
  const map = spawnSync(process.execPath, [DMS_CONTROL, "map"], {
    cwd: WORKSPACE_ROOT,
    encoding: "utf8",
  });
  if (map.status === 0) return [];
  const output = `${map.stdout}${map.stderr}`.trim();
  return output === ""
    ? [`dms-control map exited with ${map.status ?? map.signal}`]
    : output.split("\n");
}
