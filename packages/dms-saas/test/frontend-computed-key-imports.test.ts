import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const FRONTEND_APP_DIR = fileURLToPath(
  new URL("../frontend-vue/app", import.meta.url),
);
const SOURCE_EXTENSIONS = [".vue", ".ts"];
/** `{ [NAME]: _alias` — a computed key in a destructuring pattern. */
const COMPUTED_DESTRUCTURING_KEY = /\[([A-Za-z_$][\w$]*)\]\s*:\s*_\w*/g;

interface ComputedKeyUse {
  file: string;
  name: string;
}

function listSourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return listSourceFiles(path);
    return SOURCE_EXTENSIONS.some((extension) => path.endsWith(extension))
      ? [path]
      : [];
  });
}

function isBoundInFile(source: string, name: string): boolean {
  const declaration = new RegExp(`\\b(?:const|let|var)\\s+${name}\\b`);
  const namedImport = new RegExp(`import\\s*\\{[^}]*\\b${name}\\b[^}]*\\}`);
  return declaration.test(source) || namedImport.test(source);
}

function findUnboundComputedKeys(): ComputedKeyUse[] {
  return listSourceFiles(FRONTEND_APP_DIR).flatMap((file) => {
    const source = readFileSync(file, "utf8");
    return [...source.matchAll(COMPUTED_DESTRUCTURING_KEY)]
      .map((match) => ({ file, name: match[1] }))
      .filter((use) => !isBoundInFile(source, use.name));
  });
}

describe("frontend computed destructuring keys", () => {
  // The auto-import scan does not see an identifier used only as a computed
  // key in a destructuring pattern: it is typed, yet undefined at runtime.
  it("are declared or imported explicitly in their own file", () => {
    expect(findUnboundComputedKeys()).toEqual([]);
  });
});
