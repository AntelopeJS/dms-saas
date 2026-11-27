import { fileURLToPath } from "node:url";
import { testTimeouts } from "@antelopejs/tooling-configs/vitest";
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
    },
  },
  test: {
    ...testTimeouts,
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
          // oxlint-disable-next-line antelopejs/shared-test-timeout -- each journey test boots a whole run of the playground with MongoDB
          testTimeout: 300_000,
          // oxlint-disable-next-line antelopejs/shared-test-timeout -- the global setup and the per-test database of a journey take minutes on a cold runner
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
