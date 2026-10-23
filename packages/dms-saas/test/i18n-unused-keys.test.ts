import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { flattenLocale, readLocale } from "./helpers/locales";

const REFERENCE_LOCALE = "en-GB";
const SOURCE_ROOTS = [
  "../src",
  "../frontend-vue/app",
  "../frontend-vue/dms.frontend.ts",
  "../../interface-dms-saas/src",
  "../playground/src",
];
const SOURCE_EXTENSION = /\.(ts|vue|mjs)$/;
/** `const NAME = "$saas.x"` or `` const NAME = `${OTHER}.x` ``: a key prefix. */
const KEY_CONSTANT =
  /\bconst\s+([A-Za-z_]\w*)\s*(?::[^=]+)?=\s*(["'`])\$?((?:\$\{\w+\}|[a-z])[A-Za-z0-9_.${}]*)\2/g;
const INTERPOLATION = /\$\{(\w+)\}/g;
/** A string naming a dotted key, `$` prefix optional. */
const KEY_LITERAL = /(["'`])\$?([a-z][a-z0-9_]*(?:\.[a-z0-9_]+)+)\1/g;
/** A key built at runtime: a static head, then interpolated segments. */
const DYNAMIC_KEY =
  /\$?([a-z][a-z0-9_]*(?:\.[A-Za-z0-9_]+)*\.)((?:[A-Za-z0-9_.]*\$\{[^}]*\})+[A-Za-z0-9_.]*)/g;
const ANY_PLACEHOLDER = /\$\{[^}]*\}/;
const KEY_CHARACTERS = "[A-Za-z0-9_.]*";
/** A run of key characters: a key is named where a run is it or starts with it. */
const KEY_RUN = /[A-Za-z0-9_.]+/g;
const SEGMENT_SEPARATOR = ".";
const NAMESPACE_DEPTH = 2;
/** Constant resolutions chained in one file (`D` built from `TEXTS`). */
const RESOLUTION_PASSES = 3;

function sourceFiles(path: URL): string[] {
  if (statSync(path).isFile()) return [fileURLToPath(path)];
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
    const child = new URL(
      `${entry.name}${entry.isDirectory() ? "/" : ""}`,
      path.href.endsWith("/") ? path : `${path.href}/`,
    );
    if (entry.isDirectory()) return sourceFiles(child);
    return SOURCE_EXTENSION.test(entry.name) ? [fileURLToPath(child)] : [];
  });
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function resolveConstants(source: string): Map<string, string> {
  const constants = new Map<string, string>();
  const resolve = (text: string) =>
    text.replace(
      INTERPOLATION,
      (whole, name: string) => constants.get(name) ?? whole,
    );
  for (let pass = 0; pass < RESOLUTION_PASSES; pass++) {
    for (const match of source.matchAll(KEY_CONSTANT)) {
      constants.set(match[1], resolve(match[3]).replace(/^\$/, ""));
    }
  }
  return constants;
}

/**
 * Prefix constants handed whole to code that appends the rest
 * (`blockMeta(PERMISSIONS, key, icon)`), rather than interpolated.
 */
function handedConstants(
  source: string,
  constants: Map<string, string>,
  prefixes: Set<string>,
): string[] {
  const body = source.replace(KEY_CONSTANT, "");
  return [...constants]
    .filter(([name, value]) => {
      if (!prefixes.has(value)) return false;
      const bare = new RegExp(`(?<![\\w.$\\{])${name}\\b(?!\\s*\\})`);
      return bare.test(body);
    })
    .map(([, value]) => value);
}

interface KeyReferences {
  /**
   * Every run of key characters in the sources (key constants written out),
   * with each of its dotted heads: one lookup per key in place of one regex
   * scan of every source per key, which timed out under a loaded runner.
   */
  names: Set<string>;
  /** Keys built at runtime, as patterns over the key. */
  patterns: RegExp[];
  /** Prefixes handed whole to code that appends the rest (`statusItems`). */
  roots: string[];
}

function collectReferences(prefixes: Set<string>): KeyReferences {
  const references: KeyReferences = {
    names: new Set(),
    patterns: [],
    roots: [],
  };
  const files = SOURCE_ROOTS.flatMap((root) =>
    sourceFiles(new URL(root, import.meta.url)),
  );
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    const constants = resolveConstants(source);
    const resolved = source.replace(
      INTERPOLATION,
      (whole, name: string) => constants.get(name) ?? whole,
    );
    addNames(resolved, references.names);
    references.roots.push(...handedConstants(source, constants, prefixes));
    for (const match of resolved
      .replace(KEY_CONSTANT, "")
      .matchAll(KEY_LITERAL))
      if (prefixes.has(match[2])) references.roots.push(match[2]);
    for (const match of resolved.matchAll(DYNAMIC_KEY)) {
      const parts = match[2].split(ANY_PLACEHOLDER).map(escapeRegExp);
      references.patterns.push(
        new RegExp(`^${escapeRegExp(match[1])}${parts.join(KEY_CHARACTERS)}$`),
      );
    }
  }
  return references;
}

function addNames(source: string, names: Set<string>): void {
  for (const [run] of source.matchAll(KEY_RUN)) {
    names.add(run);
    let end = run.indexOf(SEGMENT_SEPARATOR);
    while (end !== -1) {
      names.add(run.slice(0, end));
      end = run.indexOf(SEGMENT_SEPARATOR, end + 1);
    }
  }
}

function keyPrefixes(keys: string[]): Set<string> {
  const prefixes = new Set<string>();
  for (const key of keys) {
    const segments = key.split(".");
    for (let end = NAMESPACE_DEPTH; end < segments.length; end++)
      prefixes.add(segments.slice(0, end).join("."));
  }
  return prefixes;
}

function isReferenced(key: string, references: KeyReferences): boolean {
  return (
    references.names.has(key) ||
    references.roots.some((root) => key.startsWith(`${root}.`)) ||
    references.patterns.some((pattern) => pattern.test(key))
  );
}

describe("saas locale keys", () => {
  // Written out, through a key constant (`${TEXTS}.title`), or built from a
  // static head (`saas.status.${family}.${status}`): a key nothing names is
  // dead text both locales carry for nothing.
  it("are each read somewhere in the module", () => {
    const keys = [...flattenLocale(readLocale(REFERENCE_LOCALE)).keys()];
    const references = collectReferences(keyPrefixes(keys));

    expect(keys.filter((key) => !isReferenced(key, references))).toEqual([]);
  });
});
