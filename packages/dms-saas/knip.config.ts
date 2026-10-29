import { antelopeKnipConfig } from "../../knip.config.ts";

/**
 * The suite lives in `test/`, not `src/test`, so the default entries reach
 * none of it, and `knip:all` would report every export the tests import as
 * unused. The Stripe CLI, which drives the webhook script, is not an npm
 * package. The suite imports the Vue the frontend layer's composables run on
 * by path (`test/helpers/frontend-vue.ts`): the layer's own `package.json`
 * declares it.
 */
export default antelopeKnipConfig({
  entry: ["test/**/*.test.ts"],
  project: ["test/**/*.ts"],
  ignoreBinaries: ["stripe"],
  ignoreDependencies: ["vue"],
});
