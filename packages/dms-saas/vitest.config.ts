import { fileURLToPath } from "node:url";
import vue from "@vitejs/plugin-vue";
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
  plugins: [vue()],
  resolve: {
    alias: {
      "@antelopejs/dms-saas": sourceRoot,
      "@antelopejs/interface-dms-saas": interfaceSourceRoot,
      "dms-e2e-kit": fileURLToPath(
        new URL("./node_modules/@antelopejs/dms/e2e", import.meta.url),
      ),
    },
  },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          include: ["test/**/*.test.ts"],
          exclude: ["test/**/*.dom.test.ts", "test/**/*.journeys.test.ts"],
          globalSetup: ["test/global-setup.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "journeys",
          include: ["test/**/*.journeys.test.ts"],
          globalSetup: ["test/journeys/global-setup.ts"],
          fileParallelism: false,
          testTimeout: 300_000,
          hookTimeout: 1_200_000,
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
  oxc: {
    target: "esnext",
    decorator: { legacy: true, emitDecoratorMetadata: true },
  },
});
