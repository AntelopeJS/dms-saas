import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const manifest = JSON.parse(
  fs.readFileSync(path.join(packageRoot, "package.json"), "utf8"),
);
const NON_CODE_SUBPATHS = new Set(["./package.json"]);

/** Every `types`/`default` target a conditional export resolves to. */
function exportTargets(value) {
  if (typeof value === "string") return [value];
  if (value === null || typeof value !== "object") return [];
  return Object.values(value).flatMap(exportTargets);
}

function exportEntries() {
  return Object.entries(manifest.exports ?? {})
    .filter(([subpath]) => !NON_CODE_SUBPATHS.has(subpath))
    .flatMap(([subpath, value]) =>
      exportTargets(value).map((target) => ({ subpath, target })),
    );
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** `./dist/*.js` -> `/^dist\/.+\.js$/`, so a built file can be matched to it. */
function targetMatcher(target) {
  const relative = target.replace(/^\.\//, "");
  const [prefix, suffix] = relative.split("*");
  if (suffix === undefined) return null;
  return new RegExp(`^${escapeRegExp(prefix)}.+${escapeRegExp(suffix)}$`);
}

/**
 * The files `dist` publishes, relative to the package root. `files` ships the
 * whole directory minus `.tsbuildinfo`, so the build output is the file list.
 */
function builtFiles() {
  const distRoot = path.join(packageRoot, "dist");
  if (!fs.existsSync(distRoot)) {
    throw new Error("dist/ is missing: run the build before this check.");
  }
  return new Set(
    fs
      .readdirSync(distRoot, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name !== ".tsbuildinfo")
      .map((entry) =>
        path
          .relative(packageRoot, path.join(entry.parentPath, entry.name))
          .split(path.sep)
          .join("/"),
      ),
  );
}

/**
 * A literal `exports` entry that points at a file the build does not emit is
 * a subpath every consumer resolves and then fails to load.
 */
function danglingExports(files) {
  return exportEntries()
    .filter(({ target }) => !target.includes("*"))
    .filter(({ target }) => !files.has(target.replace(/^\.\//, "")))
    .map(({ subpath, target }) => `${subpath} -> ${target}`);
}

/**
 * The inverse: a built module no `exports` entry resolves to is dead weight
 * in the tarball, and a surface the package silently does not publish.
 */
function unreachableModules(files) {
  const matchers = exportEntries()
    .map(({ target }) => targetMatcher(target))
    .filter(Boolean);
  const literals = new Set(
    exportEntries()
      .filter(({ target }) => !target.includes("*"))
      .map(({ target }) => target.replace(/^\.\//, "")),
  );
  return [...files]
    .filter((file) => file.startsWith("dist/") && file.endsWith(".js"))
    .filter((file) => !literals.has(file))
    .filter((file) => !matchers.some((matcher) => matcher.test(file)));
}

/**
 * A `./*` pattern resolves `<sub>` to `dist/<sub>.js` and nothing else: Node
 * never falls back to `<sub>/index.js` inside `exports`. Every built directory
 * index therefore needs a literal entry of its own, or the subpath that reads
 * naturally is unreachable.
 */
function missingDirectoryExports(files) {
  const literalSubpaths = new Set(
    Object.keys(manifest.exports ?? {}).filter((key) => !key.includes("*")),
  );
  return [...files]
    .filter((file) => file.startsWith("dist/") && file.endsWith("/index.js"))
    .map((file) => file.slice("dist/".length))
    .map((relative) =>
      relative === "index.js"
        ? "."
        : `./${relative.replace(/\/index\.js$/, "")}`,
    )
    .filter((subpath) => !literalSubpaths.has(subpath));
}

const files = builtFiles();
const checks = [
  {
    label: "exports entries pointing at files the build does not emit",
    items: danglingExports(files),
  },
  {
    label: "built modules no exports entry resolves to",
    items: unreachableModules(files),
  },
  {
    label: "built directory indexes without an explicit exports entry",
    items: missingDirectoryExports(files),
  },
];
const failures = checks.filter((check) => check.items.length > 0);

if (failures.length > 0) {
  throw new Error(
    failures
      .map((check) => `${check.label}: ${check.items.join(", ")}`)
      .join("\n"),
  );
}

const published = [...files].filter(
  (file) => file.startsWith("dist/") && file.endsWith(".js"),
).length;
console.log(
  `Interface package exports are valid: ${published} built modules, all reachable through ${exportEntries().length} exports targets.`,
);
