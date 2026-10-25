import { defineConfig } from "oxlint";
import {
  ANTELOPE_IGNORE_PATTERNS,
  antelopePreset,
} from "@antelopejs/tooling-configs/oxc/lint";

/**
 * The Vue layer keeps its own ESLint setup until the front end migrates.
 * Import sorting stays off until a repository-wide pass reorders every file at
 * once. Type-aware rules resolve `@antelopejs/interface-dms-saas` through its
 * built `dist`, so lint runs after the build.
 */
export default defineConfig({
  extends: [antelopePreset({ importSorting: false })],
  ignorePatterns: [
    ...ANTELOPE_IGNORE_PATTERNS,
    "packages/dms-saas/frontend-vue/**",
  ],
  options: { typeAware: true, maxWarnings: 0 },
  overrides: [
    {
      files: ["packages/dms-saas/test/**"],
      rules: {
        "eslint/max-lines": "off",
        "eslint/max-lines-per-function": "off",
        "typescript/unbound-method": "off",
        "typescript/no-misused-spread": "off",
        "anti-slop/no-chained-type-assertions": "off",
        "anti-slop/no-object-parameters": "off",
      },
    },
  ],
});
