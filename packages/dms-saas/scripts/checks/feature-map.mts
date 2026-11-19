import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { join, matchesGlob } from "node:path";
import { covers, notUserFacing, userFacing } from "../../../../e2e/coverage.ts";

const WORKSPACE_ROOT = join(import.meta.dirname, "..", "..", "..", "..");
const JOURNEYS = join(WORKSPACE_ROOT, "e2e", "journeys");
const SMOKE = "smoke";

const matchesAny = (file: string, globs: readonly string[]): boolean =>
  globs.some((glob) => matchesGlob(file, glob));

/**
 * The feature map of `e2e/coverage.ts`: every feature of `e2e/journeys/`
 * has an entry and every entry a journeys file, every feature but the smoke
 * one lists globs, each glob matches a tracked file, and every tracked
 * user-facing file is in a feature's globs.
 *
 * @returns One line per finding
 */
export function featureMapFailures(): string[] {
  const tracked = execFileSync("git", ["ls-files"], {
    cwd: WORKSPACE_ROOT,
    encoding: "utf8",
  })
    .split("\n")
    .filter(Boolean);
  const features = readdirSync(JOURNEYS)
    .filter((file) => file.endsWith(".mjs"))
    .map((file) => file.slice(0, -".mjs".length));
  const globs = Object.values(covers).flat();
  return [
    ...features
      .filter((feature) => !Object.hasOwn(covers, feature))
      .map((feature) => `e2e/journeys/${feature}.mjs has no covers entry`),
    ...Object.entries(covers).flatMap(([feature, owned]) => [
      ...(features.includes(feature)
        ? []
        : [`covers entry ${feature} has no e2e/journeys/${feature}.mjs`]),
      ...(feature !== SMOKE && owned.length === 0
        ? [`${feature} lists no covers globs`]
        : []),
      ...owned
        .filter((glob) => !tracked.some((file) => matchesGlob(file, glob)))
        .map((glob) => `${feature}: glob ${glob} matches no tracked file`),
    ]),
    ...tracked
      .filter(
        (file) =>
          matchesAny(file, userFacing) &&
          !matchesAny(file, notUserFacing) &&
          !matchesAny(file, globs),
      )
      .map((file) => `${file} is in no feature's covers`),
  ];
}
