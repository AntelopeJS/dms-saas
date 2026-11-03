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
  oxc: {
    target: "esnext",
    decorator: { legacy: true, emitDecoratorMetadata: true },
  },
});
