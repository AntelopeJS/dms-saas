import { readdirSync, readFileSync, statSync } from "node:fs";
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
const NAMESPACE_DEPTH = 2;
/** Constant resolutions chained in one file (`D` built from `TEXTS`). */
const RESOLUTION_PASSES = 3;

function sourceFiles(path: URL): string[] {
  if (statSync(path).isFile()) return [path.pathname];
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
    const child = new URL(
      `${entry.name}${entry.isDirectory() ? "/" : ""}`,
      path.href.endsWith("/") ? path : `${path.href}/`,
    );
    if (entry.isDirectory()) return sourceFiles(child);
    return SOURCE_EXTENSION.test(entry.name) ? [child.pathname] : [];
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

interface KeyReferences {
  /** Every source file, its key constants written out. */
  text: string;
  /** Keys built at runtime, as patterns over the key. */
  patterns: RegExp[];
  /** Prefixes handed whole to code that appends the rest (`statusItems`). */
  roots: string[];
}

function collectReferences(prefixes: Set<string>): KeyReferences {
  const references: KeyReferences = { text: "", patterns: [], roots: [] };
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
    references.text += `${resolved}\n`;
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
  const literal = new RegExp(
    `(?<![A-Za-z0-9_.])${escapeRegExp(key)}(?![A-Za-z0-9_])`,
  );
  return (
    literal.test(references.text) ||
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
