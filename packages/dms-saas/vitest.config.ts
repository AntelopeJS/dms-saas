import { fileURLToPath } from "node:url";
import vue from "@vitejs/plugin-vue";
import { defineConfig, type ViteUserConfig } from "vitest/config";

const sourceRoot = fileURLToPath(new URL("./src", import.meta.url));
const interfaceSourceRoot = fileURLToPath(
  new URL("../interface-dms-saas/src", import.meta.url),
);

/**
 * Pure frontend helpers and decorated backend classes share this test runner.
 * Oxc accepts tsconfig overrides outside Vite's public option type.
 */
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

/**
 * Scoped to this module's own tests: the playground caches the DMS package
 * sources, which carry a test suite the default glob would collect.
 */
export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      "@antelopejs/dms-saas": sourceRoot,
      "@antelopejs/interface-dms-saas": interfaceSourceRoot,
    },
  },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          include: ["test/**/*.test.ts"],
          exclude: ["test/**/*.dom.test.ts"],
          globalSetup: ["test/global-setup.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "frontend",
          include: ["test/**/*.dom.test.ts"],
          environment: "happy-dom",
        },
      },
    ],
  },
  oxc,
});
