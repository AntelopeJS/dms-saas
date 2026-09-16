import { fileURLToPath } from "node:url";
import { defineConfig, type ViteUserConfig } from "vitest/config";

const sourceRoot = fileURLToPath(new URL("./src", import.meta.url));
const interfaceSourceRoot = fileURLToPath(
  new URL("../interface-dms-saas/src", import.meta.url),
);

// Pure frontend helpers and decorated backend classes share this test runner.
// Oxc accepts tsconfig overrides outside Vite's public option type.
const oxc = {
  tsconfig: {
    compilerOptions: {
      target: "esnext",
      experimentalDecorators: true,
      emitDecoratorMetadata: true,
      useDefineForClassFields: true,
      strict: true,
    },
  },
} as ViteUserConfig["oxc"];

// Scoped to this module's own tests: the playground caches the DMS package
// sources, which carry a test suite the default glob would collect.
export default defineConfig({
  resolve: {
    alias: {
      "@antelopejs/dms-saas": sourceRoot,
      "@antelopejs/interface-dms-saas": interfaceSourceRoot,
    },
  },
  test: {
    include: ["test/**/*.test.ts"],
  },
  oxc,
});
