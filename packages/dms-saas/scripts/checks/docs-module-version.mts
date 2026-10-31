import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

const PACKAGE_ROOT = join(import.meta.dirname, "..", "..");
const WORKSPACE_ROOT = join(PACKAGE_ROOT, "..", "..");
const SOURCE =
  /["']?package["']?\s*:\s*"@antelopejs\/dms-saas"\s*,\s*["']?version["']?\s*:\s*"(?<spec>[^"]*)"/g;
const CARET = /^\^(?<major>\d+)\.(?<minor>\d+)\.(?<patch>\d+)$/;

/** A `major.minor.patch` triple of non-negative integers. */
type Triple = readonly [major: number, minor: number, patch: number];

function isTriple(parts: readonly number[]): parts is Triple {
  return parts.length === 3 && parts.every(Number.isSafeInteger);
}

function parseTriple(...parts: string[]): Triple | undefined {
  const numbers = parts.map(Number);
  return isTriple(numbers) ? numbers : undefined;
}

/** Whether `^floor` selects `version`: same leftmost non-zero part, not below the floor. */
function caretAdmits(floor: Triple, version: Triple): boolean {
  const [major, minor, patch] = floor;
  if (major > 0) {
    return (
      version[0] === major &&
      (version[1] > minor || (version[1] === minor && version[2] >= patch))
    );
  }
  if (minor > 0) {
    return version[0] === 0 && version[1] === minor && version[2] >= patch;
  }
  return version[0] === 0 && version[1] === 0 && version[2] === patch;
}

/** A package manifest's own `version` field holding a string. */
interface Manifest {
  version: string;
}

function isManifest(value: unknown): value is Manifest {
  return (
    typeof value === "object" &&
    value !== null &&
    "version" in value &&
    Object.hasOwn(value, "version") &&
    typeof value.version === "string"
  );
}

function markdownFiles(path: string): string[] {
  if (!existsSync(path)) {
    return [];
  }
  if (path.endsWith(".md")) {
    return [path];
  }
  return readdirSync(path, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => join(entry.parentPath, entry.name));
}

/** The root README, then the README, docs and skills of every package of the workspace. */
function scannedFiles(): string[] {
  const packagesRoot = join(WORKSPACE_ROOT, "packages");
  const paths = [
    join(WORKSPACE_ROOT, "README.md"),
    ...readdirSync(packagesRoot).flatMap((name) => [
      join(packagesRoot, name, "README.md"),
      join(packagesRoot, name, "docs"),
      join(packagesRoot, name, "skills"),
    ]),
  ];
  return paths.flatMap(markdownFiles);
}

/** The version of this package, as written and as a triple. */
interface CurrentVersion {
  text: string;
  triple: Triple;
}

function currentVersion(): CurrentVersion {
  const manifest: unknown = JSON.parse(
    readFileSync(join(PACKAGE_ROOT, "package.json"), "utf8"),
  );
  if (!isManifest(manifest)) {
    throw new Error("package.json: no version string");
  }
  const [release = "", ...rest] = manifest.version.split("-");
  const triple = parseTriple(...release.split("."));
  if (triple === undefined || rest.length > 0) {
    throw new Error(
      `package.json: ${manifest.version} is not major.minor.patch`,
    );
  }
  return { text: manifest.version, triple };
}

/**
 * A config example installs the module through `source.version`, an npm
 * version spec resolved against the registry. A caret range on a `0.x`
 * version stops at the next minor, so `^0.6.0` installs 0.6.x and never 0.7.
 * Every example of this module in the READMEs, the docs and the skills of the
 * workspace must name a caret range that admits the version of this package.
 */
export function docsModuleVersionFailures(): string[] {
  const current = currentVersion();
  const failures: string[] = [];
  let examples = 0;
  for (const file of scannedFiles()) {
    const text = readFileSync(file, "utf8");
    for (const match of text.matchAll(SOURCE)) {
      examples += 1;
      const spec = match.groups?.spec ?? "";
      const caret = CARET.exec(spec)?.groups;
      const floor =
        caret === undefined
          ? undefined
          : parseTriple(
              caret.major ?? "",
              caret.minor ?? "",
              caret.patch ?? "",
            );
      if (floor === undefined || !caretAdmits(floor, current.triple)) {
        const line = text.slice(0, match.index).split("\n").length;
        failures.push(
          `${relative(WORKSPACE_ROOT, file)}:${line}: version "${spec}" is not a caret range that selects ${current.text}; write "^${current.text}"`,
        );
      }
    }
  }
  return examples === 0
    ? [
        "no config example of @antelopejs/dms-saas found in the READMEs, docs or skills; the check would pass on nothing",
      ]
    : failures;
}
