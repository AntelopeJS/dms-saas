import { existsSync, readdirSync, rmSync } from "node:fs";
import { join, relative } from "node:path";

/** What `tsc` emits for one source file, longest suffix first. */
const OUTPUT_SUFFIXES = [".d.ts.map", ".js.map", ".d.ts", ".js"];
/** The extensions a source file of the package may have (`allowJs`). */
const SOURCE_EXTENSIONS = [".ts", ".js"];

/**
 * Deletes every compiled output under `<package>/dist` whose source under `<package>/src` is gone, so an
 * incremental `tsc` leaves the same files as a clean build. A leftover `x.js` would otherwise shadow a new
 * `x/index.js`, since Node resolves `./x` to the file first.
 *
 * @param {string} packageDir The package folder, holding `src` and `dist`
 */
function pruneOrphanedOutputs(packageDir) {
  const dist = join(packageDir, "dist");
  if (!existsSync(dist)) return;
  for (const entry of readdirSync(dist, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const output = relative(dist, join(entry.parentPath, entry.name));
    const suffix = OUTPUT_SUFFIXES.find((candidate) => output.endsWith(candidate));
    if (!suffix) continue;
    const stem = output.slice(0, -suffix.length);
    const hasSource = SOURCE_EXTENSIONS.some((extension) =>
      existsSync(join(packageDir, "src", `${stem}${extension}`)),
    );
    if (hasSource) continue;
    rmSync(join(dist, output));
  }
}

const packageDir = process.argv[2];
if (!packageDir) {
  console.error("usage: node prune-dist.mjs <package folder>");
  process.exit(2);
}
pruneOrphanedOutputs(packageDir);
