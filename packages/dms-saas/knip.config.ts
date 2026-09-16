import { antelopeKnipConfig } from "../../knip.config.ts";

export default antelopeKnipConfig({
  // The suite lives in test/, not src/test, so the defaults reach none of it —
  // which made knip:all report every export the tests import as unused.
  entry: ["test/**/*.test.ts"],
  project: ["test/**/*.ts"],
  // The Stripe CLI drives the webhook script and is not an npm package.
  ignoreBinaries: ["stripe"],
});
