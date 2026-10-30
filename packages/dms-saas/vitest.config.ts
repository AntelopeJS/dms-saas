import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const sourceRoot = fileURLToPath(new URL("./src", import.meta.url));
const interfaceSourceRoot = fileURLToPath(
  new URL("../interface-dms-saas/src", import.meta.url),
);

/**
 * Scoped to this module's own tests: the playground caches the DMS package
 * sources, which carry a test suite the default glob would collect.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@antelopejs/dms-saas": sourceRoot,
      "@antelopejs/interface-dms-saas": interfaceSourceRoot,
    },
  },
  test: {
    include: ["test/**/*.test.ts"],
    globalSetup: ["test/global-setup.ts"],
  },
  oxc: {
    target: "esnext",
    decorator: { legacy: true, emitDecoratorMetadata: true },
  },
});
