import { assertDmsComponents } from "@antelopejs/dms/checks/dms-components";
import { fileURLToPath } from "node:url";
import { componentRootFailures } from "./component-roots.mts";
import { docsModuleVersionFailures } from "./docs-module-version.mts";
import { localeCatalogFailures } from "./locale-catalog.mts";
import { unusedLocaleKeyFailures } from "./locale-usage.mts";
import { serverRenderedReadFailures } from "./server-rendered-reads.mts";

const CHECKS = {
  "locale catalogs": localeCatalogFailures,
  "locale keys in use": unusedLocaleKeyFailures,
  "component roots": componentRootFailures,
  "server-rendered reads": serverRenderedReadFailures,
  "docs module version": docsModuleVersionFailures,
};

const failures = Object.entries(CHECKS).flatMap(([name, check]) =>
  check().map((failure) => `[${name}] ${failure}`),
);
await assertDmsComponents({
  layer: fileURLToPath(new URL("../../frontend-vue", import.meta.url)),
  sources: [fileURLToPath(new URL("../../src", import.meta.url))],
}).catch((error: unknown) => {
  failures.push(
    `[DMS component names] ${error instanceof Error ? error.message : String(error)}`,
  );
});
if (failures.length > 0) {
  process.stderr.write(`${failures.join("\n")}\n`);
  process.exitCode = 1;
}
