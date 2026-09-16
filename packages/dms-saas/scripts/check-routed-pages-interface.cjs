const assert = require("node:assert/strict");
const Module = require("node:module");
const { createRequire } = Module;
const path = require("node:path");

// The registration primitives live in the interface package, not in the DMS
// runtime: patching them there is what makes this check see the same module
// instance the packed code registers through.
function instrumentPageRegistration(packageRequire) {
  const controllers = packageRequire(
    "@antelopejs/interface-dms/page/controllers",
  );
  const roots = packageRequire("@antelopejs/interface-dms/page/roots");
  const categoryIds = [];
  const moduleIds = [];
  const originalCategory = controllers.Category;
  const originalRegisterModule = roots.RegisterModule;
  controllers.Category = (...args) => {
    const registered = originalCategory(...args);
    categoryIds.push(registered.fullId);
    return registered;
  };
  roots.RegisterModule = (...args) => {
    const registered = originalRegisterModule(...args);
    moduleIds.push(registered.id);
    return registered;
  };
  return { categoryIds, moduleIds };
}

function loadRoutedPages(packageRequire, packageRoot) {
  const pagesSpecifier = "@antelopejs/interface-dms-saas/pages";
  const pagesEntry = packageRequire.resolve(pagesSpecifier);
  const aliasPrefix = packageRoot + path.sep.repeat(2);
  const aliasPath = (entry) => aliasPrefix + path.relative(packageRoot, entry);
  const originalResolveFilename = Module._resolveFilename;
  Module._resolveFilename = function (request, parent, isMain, options) {
    if (request === pagesSpecifier) return aliasPath(pagesEntry);
    const resolved = originalResolveFilename.call(
      this,
      request,
      parent,
      isMain,
      options,
    );
    if (!parent?.filename.startsWith(aliasPrefix)) return resolved;
    return path.isAbsolute(resolved) && resolved.startsWith(packageRoot)
      ? aliasPath(resolved)
      : resolved;
  };
  try {
    return packageRequire(pagesSpecifier);
  } finally {
    Module._resolveFilename = originalResolveFilename;
  }
}

function assertRegistrationsUnchanged(registration, countsAfterMain) {
  assert.deepEqual(registration.moduleIds, ["saas"]);
  assert.equal(registration.categoryIds.length, countsAfterMain.categories);
  assert.equal(registration.moduleIds.length, countsAfterMain.modules);
  assert.equal(
    new Set(registration.categoryIds).size,
    registration.categoryIds.length,
  );
}

function assertDescriptorShapes(pages) {
  assert.equal(pages.workspaceSettingsCategory.id, "workspace");
  assert.equal(pages.workspaceSettingsCategory.fullId, "settings.workspace");
  assert.equal(pages.workspaceSettingsCategory.fullSlug, "/settings/workspace");
  assert.equal(pages.platformSaasModule.id, "saas");
  assert.equal(pages.platformSaasModule.fullId, "modules.saas");
  assert.equal(pages.platformSaasModule.fullSlug, "/modules/saas");
}

function assertCloudPageDeclarations(packageRequire, pages) {
  const dmsPage = packageRequire("@antelopejs/interface-dms/page");
  const cloudWorkspace = dmsPage.PageController("cloud", {
    displayName: "Cloud",
    category: pages.workspaceSettingsCategory,
  });
  const cloudPlatform = dmsPage.PageController("cloud", {
    displayName: "Cloud",
    category: pages.platformSaasModule,
    module: "saas",
  });
  const { GetMetadata } = packageRequire("@antelopejs/interface-core");
  const workspaceInfo = GetMetadata(
    cloudWorkspace,
    dmsPage.PageMetadata,
  ).pageInfo;
  const platformInfo = GetMetadata(
    cloudPlatform,
    dmsPage.PageMetadata,
  ).pageInfo;
  assert.equal(workspaceInfo.fullSlug, "/settings/workspace/cloud");
  assert.equal(platformInfo.fullId, "modules.saas.cloud");
}

async function assertCanonicalGetters(packageRequire, packageRoot, pages) {
  const implementation = require(
    path.join(packageRoot, "dist/implementations/dms-saas/pages.js"),
  );
  const canonical = require(path.join(packageRoot, "dist/pages/module.js"));
  const { ImplementInterface } = packageRequire("@antelopejs/interface-core");
  assert.deepEqual(pages.platformSaasModule, canonical.saasModule);
  assert.deepEqual(
    pages.workspaceSettingsCategory,
    canonical.workspaceSettingsCategory,
  );
  assert.notEqual(pages.platformSaasModule, canonical.saasModule);
  assert.notEqual(
    pages.workspaceSettingsCategory,
    canonical.workspaceSettingsCategory,
  );
  ImplementInterface(pages, implementation);
  const [moduleRoot, workspaceCategory] = await Promise.all([
    pages.GetPlatformSaasModule(),
    pages.GetWorkspaceSettingsCategory(),
  ]);
  assert.equal(moduleRoot, canonical.saasModule);
  assert.equal(workspaceCategory, canonical.workspaceSettingsCategory);
}

async function main() {
  const packageName = process.argv[2];
  const consumerRequire = createRequire(
    path.join(process.cwd(), "consumer.js"),
  );
  const packageRoot = path.dirname(
    consumerRequire.resolve(`${packageName}/package.json`),
  );
  const packageRequire = createRequire(consumerRequire.resolve(packageName));
  const registration = instrumentPageRegistration(packageRequire);
  consumerRequire(packageName);
  const countsAfterMain = {
    categories: registration.categoryIds.length,
    modules: registration.moduleIds.length,
  };
  const pages = loadRoutedPages(packageRequire, packageRoot);
  assertRegistrationsUnchanged(registration, countsAfterMain);
  assertDescriptorShapes(pages);
  assertCloudPageDeclarations(packageRequire, pages);
  await assertCanonicalGetters(packageRequire, packageRoot, pages);
}

main().catch((error) => {
  process.nextTick(() => {
    throw error;
  });
});
