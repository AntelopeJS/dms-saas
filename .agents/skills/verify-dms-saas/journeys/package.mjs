import { readFileSync } from "node:fs";
import { join } from "node:path";
import { guarded } from "../guard.mjs";
import { check, isRow, pick } from "../saas.mjs";

/** @typedef {import("../saas.mjs").Ctx} Ctx */

/**
 * @param {Ctx} ctx The journey
 * @param {string} file The manifest, relative to the checkout
 * @returns {unknown} Its JSON
 */
function manifest(ctx, file) {
  return JSON.parse(readFileSync(join(ctx.state.repo ?? ctx.state.moduleRoot, file), "utf8"));
}

/** What a project installs from the registry: the module and the interface, as their manifests declare them. */
export const journeys = guarded([
  {
    id: "the-manifests-declare-what-the-docs-install",
    title: "the module implements the interface, ships its build, frontend and skill, and depends on the interface through a workspace range",
    entryPoint: "packages/dms-saas/package.json, packages/interface-dms-saas/package.json",
    async run(/** @type {Ctx} */ ctx) {
      const module = manifest(ctx, "packages/dms-saas/package.json");
      const contract = manifest(ctx, "packages/interface-dms-saas/package.json");
      await ctx.verify("the module package", [
        check("named @antelopejs/dms-saas", pick(module, "name") === "@antelopejs/dms-saas", pick(module, "name")),
        check("it implements @antelopejs/interface-dms-saas", JSON.stringify(pick(module, "antelopeJs", "implements")) === JSON.stringify(["@antelopejs/interface-dms-saas"]), pick(module, "antelopeJs")),
        check("it ships dist, the frontend source and the skills", ["dist", "frontend-vue", "skills"].every((entry) => Array.isArray(pick(module, "files")) && pick(module, "files").includes(entry)), pick(module, "files")),
        check("its frontend entry is dist/frontend-module.js", pick(module, "dmsFrontend") === "dist/frontend-module.js", pick(module, "dmsFrontend")),
        check("it depends on the interface through workspace:^", pick(module, "dependencies", "@antelopejs/interface-dms-saas") === "workspace:^", pick(module, "dependencies")),
        check("its entry is dist/index.js with types", pick(module, "main") === "dist/index.js" && pick(module, "types") === "dist/index.d.ts", pick(module, "main")),
      ]);
      const exportsMap = pick(contract, "exports");
      await ctx.verify("the interface package", [
        check("named @antelopejs/interface-dms-saas", pick(contract, "name") === "@antelopejs/interface-dms-saas", pick(contract, "name")),
        check("every documented subpath is exported", ["./billing", "./plans", "./pages", "./plan-changes", "./invoice-line-items", "./tenant-lifecycle", "./provisioning", "./registration", "./data-api", "./db", "./json"].every((subpath) => isRow(exportsMap) && subpath in exportsMap), exportsMap),
      ]);
    },
  },
]);
