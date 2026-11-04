/**
 * Publishes the package through pnpm. `npm publish` does not understand pnpm's
 * workspace specifiers (`workspace:`, `catalog:`): it ships them verbatim and
 * consumers cannot install the package, while pnpm resolves them as it packs.
 * release-it's own npm publish step is disabled with `npm.publish: false` in
 * .release-it.json, and this script runs from the `after:bump` hook, once the
 * new version and the changelog are written but before the release commit, tag
 * and push.
 *
 * @packageDocumentation
 */

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));

/**
 * @param {unknown} value
 * @returns {value is { name: string; version: string }}
 */
function isPackageIdentity(value) {
  return (
    typeof value === "object" &&
    value !== null &&
    "name" in value &&
    typeof value.name === "string" &&
    "version" in value &&
    typeof value.version === "string"
  );
}

/** @type {unknown} */
const manifest = JSON.parse(
  readFileSync(join(packageRoot, "package.json"), "utf8"),
);
if (!isPackageIdentity(manifest)) {
  throw new Error("package.json has no name and version");
}
const { name, version } = manifest;

const prerelease = version.split("-").slice(1).join("-");
const identifier = prerelease.split(".")[0];
const tag = prerelease
  ? /^[a-z][\w-]*$/i.test(identifier)
    ? identifier
    : "next"
  : "latest";

/**
 * `--no-git-checks`: the working tree is dirty at this point (version bump and
 * changelog), which is exactly what pnpm's git checks refuse; release-it owns
 * the git state instead.
 */
const args = ["publish", "--no-git-checks", "--tag", tag];
if (process.argv.includes("--dry-run")) {
  args.push("--dry-run");
}

console.log(`Publishing ${name}@${version} with tag ${tag}`);

const result = spawnSync("pnpm", args, { cwd: packageRoot, stdio: "inherit" });
if (result.error) {
  throw result.error;
}
process.exit(result.status ?? 1);
