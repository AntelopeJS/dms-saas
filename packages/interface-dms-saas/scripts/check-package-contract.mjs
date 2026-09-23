import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
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
const DIRECTORY_FALLBACK = ["dist/*", "dist/*/index.d.ts"];
/**
 * The identity entry needs the directory fallback too: a `<pkg>/dist/<dir>`
 * path written into an emitted declaration has no extension, so a node10
 * resolver only finds it through `dist/*\/index.d.ts`.
 */
const REQUIRED_TYPES_VERSIONS = {
  "*": { "dist/*": DIRECTORY_FALLBACK, "*": DIRECTORY_FALLBACK },
};

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

/** `./dist/*.js` -> `/^dist\/.+\.js$/`, so a packed file can be matched to it. */
function targetMatcher(target) {
  const relative = target.replace(/^\.\//, "");
  const [prefix, suffix] = relative.split("*");
  if (suffix === undefined) return null;
  return new RegExp(`^${escapeRegExp(prefix)}.+${escapeRegExp(suffix)}$`);
}

/**
 * A literal `exports` entry that points at a file the tarball does not carry
 * is a subpath every consumer resolves and then fails to load.
 */
function danglingExports(packedFiles) {
  return exportEntries()
    .filter(({ target }) => !target.includes("*"))
    .filter(({ target }) => !packedFiles.has(target.replace(/^\.\//, "")))
    .map(({ subpath, target }) => `${subpath} -> ${target}`);
}

/**
 * The inverse: a packed module no `exports` entry resolves to is dead weight
 * in the tarball, and a surface the package silently does not publish.
 */
function unreachableModules(packedFiles) {
  const matchers = exportEntries()
    .map(({ target }) => targetMatcher(target))
    .filter(Boolean);
  const literals = new Set(
    exportEntries()
      .filter(({ target }) => !target.includes("*"))
      .map(({ target }) => target.replace(/^\.\//, "")),
  );
  return [...packedFiles]
    .filter((file) => file.startsWith("dist/") && file.endsWith(".js"))
    .filter((file) => !literals.has(file))
    .filter((file) => !matchers.some((matcher) => matcher.test(file)));
}

/**
 * A `./*` pattern resolves `<sub>` to `dist/<sub>.js` and nothing else: Node
 * never falls back to `<sub>/index.js` inside `exports`. Every packed directory
 * index therefore needs a literal entry of its own, or the subpath that reads
 * naturally is unreachable for exports-aware resolvers.
 */
function missingDirectoryExports(packedFiles) {
  const literalSubpaths = new Set(
    Object.keys(manifest.exports ?? {}).filter((key) => !key.includes("*")),
  );
  return [...packedFiles]
    .filter((file) => file.startsWith("dist/") && file.endsWith("/index.js"))
    .map((file) => file.slice("dist/".length))
    .map((relative) =>
      relative === "index.js"
        ? "."
        : `./${relative.replace(/\/index\.js$/, "")}`,
    )
    .filter((subpath) => !literalSubpaths.has(subpath));
}

/**
 * TypeScript's declaration emit rewrites an import the consumer wrote as
 * `<pkg>/db/tables/plans.table` into the `typesVersions` target it resolved to,
 * `<pkg>/dist/db/tables/plans.table`. An exports-aware consumer of that `.d.ts`
 * then has to resolve the rewritten path, so every subpath needs a types-only
 * `./dist/...` twin.
 */
function missingDistMirrors() {
  const subpaths = Object.keys(manifest.exports ?? {}).filter(
    (key) => !NON_CODE_SUBPATHS.has(key) && !key.startsWith("./dist"),
  );
  return subpaths
    .map((subpath) =>
      subpath === "." ? "./dist" : `./dist${subpath.slice(1)}`,
    )
    .filter((mirror) => !(mirror in (manifest.exports ?? {})));
}

/** The exact shape every interface package in the fleet publishes. */
function typesVersionsMismatch() {
  const actual = JSON.stringify(manifest.typesVersions);
  const expected = JSON.stringify(REQUIRED_TYPES_VERSIONS);
  return actual === expected ? [] : [`${actual} should be ${expected}`];
}

/**
 * A packed subpath is only usable if a consumer can resolve it in the three
 * resolution modes the fleet compiles under, so the probe runs all of them.
 */
const RESOLUTION_MODES = [
  { name: "node", module: "commonjs", moduleResolution: "node" },
  {
    name: "node16",
    module: "Node16",
    moduleResolution: "Node16",
    resolvesThroughExports: true,
  },
  {
    name: "bundler",
    module: "esnext",
    moduleResolution: "bundler",
    resolvesThroughExports: true,
  },
];

/**
 * `typesVersions` rewrites `<pkg>/<sub>` into `dist/<sub>`, so the root twin
 * `<pkg>/dist` is the one mirror a node10 resolver has no pattern for -- and
 * the one no declaration emit ever produces, since the root import needs no
 * rewriting. Exports-aware modes still have to resolve it.
 */
const NODE10_UNREACHABLE_SUBPATHS = new Set(["./dist"]);

/** Every literal subpath, `./dist` twins included, as an import specifier. */
function probeSpecifiers(mode) {
  return Object.keys(manifest.exports ?? {})
    .filter((subpath) => !NON_CODE_SUBPATHS.has(subpath))
    .filter((subpath) => !subpath.includes("*"))
    .filter(
      (subpath) =>
        mode.resolvesThroughExports ||
        !NODE10_UNREACHABLE_SUBPATHS.has(subpath),
    )
    .map((subpath) =>
      subpath === "." ? manifest.name : `${manifest.name}/${subpath.slice(2)}`,
    );
}

function consumerSource(mode) {
  const specifiers = probeSpecifiers(mode);
  const imports = specifiers.map(
    (specifier, index) => `import type * as probe${index} from "${specifier}";`,
  );
  const members = specifiers.map((_, index) => `typeof probe${index}`);
  return [...imports, `export type Probe = [${members.join(", ")}];`, ""].join(
    "\n",
  );
}

/**
 * The probe needs the package's own dependency and peer closure on disk:
 * without it, `skipLibCheck: false` would only report missing peers instead of
 * the resolution failures this check exists to catch.
 */
function linkInstalledClosure(modulesRoot) {
  const installed = path.join(packageRoot, "node_modules");
  const link = (source, target) => {
    if (fs.existsSync(target)) return;
    fs.symlinkSync(fs.realpathSync(source), target, "junction");
  };
  for (const entry of fs.readdirSync(installed)) {
    if (entry.startsWith(".")) continue;
    if (!entry.startsWith("@")) {
      link(path.join(installed, entry), path.join(modulesRoot, entry));
      continue;
    }
    const scopeRoot = path.join(modulesRoot, entry);
    fs.mkdirSync(scopeRoot, { recursive: true });
    for (const scoped of fs.readdirSync(path.join(installed, entry))) {
      link(path.join(installed, entry, scoped), path.join(scopeRoot, scoped));
    }
  }
}

function writeProbe(tarball, probeRoot) {
  const modulesRoot = path.join(probeRoot, "node_modules");
  const installRoot = path.join(modulesRoot, manifest.name);
  fs.mkdirSync(modulesRoot, { recursive: true });
  linkInstalledClosure(modulesRoot);
  fs.rmSync(installRoot, { recursive: true, force: true });
  fs.mkdirSync(installRoot, { recursive: true });
  execFileSync("tar", [
    "-xzf",
    tarball,
    "-C",
    installRoot,
    "--strip-components=1",
  ]);
  for (const mode of RESOLUTION_MODES) {
    fs.writeFileSync(
      path.join(probeRoot, `consumer.${mode.name}.ts`),
      consumerSource(mode),
    );
    fs.writeFileSync(
      path.join(probeRoot, `tsconfig.${mode.name}.json`),
      JSON.stringify({
        compilerOptions: {
          module: mode.module,
          moduleResolution: mode.moduleResolution,
          noEmit: true,
          skipLibCheck: false,
          strict: true,
          target: "es2022",
          // TypeScript 6 no longer loads every @types package by default.
          types: ["node"],
          // The legacy `node` (node10) mode is probed on purpose; TypeScript 6
          // only deprecates it.
          ignoreDeprecations: "6.0",
        },
        files: [`consumer.${mode.name}.ts`],
      }),
    );
  }
}

/**
 * The shapes above are read off the manifest; this one is measured. Declaration
 * emit rewrites subpaths into their `./dist` twins, and only a real compilation
 * proves a consumer can follow them back.
 */
function unresolvableSubpaths(tarball, temporaryRoot) {
  const probeRoot = path.join(temporaryRoot, "probe");
  fs.mkdirSync(probeRoot, { recursive: true });
  writeProbe(tarball, probeRoot);
  const typescriptBin = createRequire(import.meta.url).resolve(
    "typescript/bin/tsc",
  );
  return RESOLUTION_MODES.flatMap((mode) => {
    let diagnostics = "";
    try {
      execFileSync(
        process.execPath,
        [typescriptBin, "--project", `tsconfig.${mode.name}.json`],
        { cwd: probeRoot, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
      );
    } catch (error) {
      diagnostics = String(error.stdout ?? "");
    }
    return diagnostics
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => `[${mode.name}] ${line}`);
  });
}

const temporaryRoot = fs.mkdtempSync(
  path.join(os.tmpdir(), "interface-dms-saas-package-contract-"),
);

try {
  const tarball = path.join(temporaryRoot, "package.tgz");
  execFileSync(
    "pnpm",
    ["--config.ignore-scripts=true", "pack", "--out", tarball],
    { cwd: packageRoot, stdio: "ignore" },
  );
  const packedFiles = new Set(
    execFileSync("tar", ["-tzf", tarball], { encoding: "utf8" })
      .split("\n")
      .map((entry) => entry.trim())
      .filter((entry) => entry.startsWith("package/"))
      .map((entry) => entry.slice("package/".length)),
  );

  const checks = [
    {
      label: "exports entries pointing at files the tarball does not carry",
      items: danglingExports(packedFiles),
    },
    {
      label: "packed modules no exports entry resolves to",
      items: unreachableModules(packedFiles),
    },
    {
      label: "packed directory indexes without an explicit exports entry",
      items: missingDirectoryExports(packedFiles),
    },
    {
      label: "subpaths without a types-only ./dist mirror",
      items: missingDistMirrors(),
    },
    {
      label: "typesVersions does not match the fleet recipe",
      items: typesVersionsMismatch(),
    },
    {
      label: "subpaths a consumer cannot resolve or type-check",
      items: unresolvableSubpaths(tarball, temporaryRoot),
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

  const published = [...packedFiles].filter(
    (file) => file.startsWith("dist/") && file.endsWith(".js"),
  ).length;
  console.log(
    `Interface package contract is valid: ${published} packed modules, all reachable through ${exportEntries().length} exports targets and type-checked in ${RESOLUTION_MODES.length} resolution modes.`,
  );
} finally {
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
}
