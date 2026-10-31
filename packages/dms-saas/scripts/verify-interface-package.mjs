import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const packagePath = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "interface-dms-saas",
  "package.json",
);

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
const pkg = JSON.parse(readFileSync(packagePath, "utf8"));
if (!isPackageIdentity(pkg)) {
  throw new Error(`${packagePath} has no name and version`);
}
const registry = "https://registry.npmjs.org/";
const result = spawnSync(
  "npm",
  ["view", `${pkg.name}@${pkg.version}`, "version", `--registry=${registry}`],
  { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] },
);

if (result.status !== 0 || result.stdout.trim() !== pkg.version) {
  console.error(
    `${pkg.name}@${pkg.version} is not resolvable from ${registry}; publish it separately before releasing the module.`,
  );
  process.exit(result.status || 1);
}
