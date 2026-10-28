import { componentRootFailures } from "./component-roots.mts";
import { localeCatalogFailures } from "./locale-catalog.mts";
import { unusedLocaleKeyFailures } from "./locale-usage.mts";
import { serverRenderedReadFailures } from "./server-rendered-reads.mts";

const CHECKS = {
  "locale catalogs": localeCatalogFailures,
  "locale keys in use": unusedLocaleKeyFailures,
  "component roots": componentRootFailures,
  "server-rendered reads": serverRenderedReadFailures,
};

const failures = Object.entries(CHECKS).flatMap(([name, check]) =>
  check().map((failure) => `[${name}] ${failure}`),
);
if (failures.length > 0) {
  process.stderr.write(`${failures.join("\n")}\n`);
  process.exitCode = 1;
}
