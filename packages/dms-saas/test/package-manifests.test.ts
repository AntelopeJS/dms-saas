import { expect, test } from "vitest";
import contractManifest from "../../interface-dms-saas/package.json" with { type: "json" };
import moduleManifest from "../package.json" with { type: "json" };

test("the-manifests-declare-what-the-docs-install", () => {
  expect(moduleManifest).toMatchObject({
    name: "@antelopejs/dms-saas",
    main: "dist/index.js",
    types: "dist/index.d.ts",
    dmsFrontend: "dist/frontend-module.js",
    dependencies: { "@antelopejs/interface-dms-saas": "workspace:^" },
    antelopeJs: { implements: ["@antelopejs/interface-dms-saas"] },
  });
  expect(moduleManifest.files).toEqual(
    expect.arrayContaining(["dist", "frontend-vue", "skills"]),
  );
  expect(contractManifest.exports["./*"]).toEqual({
    types: "./dist/*.d.ts",
    default: "./dist/*.js",
  });
  expect(Object.keys(contractManifest.exports)).toEqual(
    expect.arrayContaining(["./db", "./db/models", "./db/tables"]),
  );
});
