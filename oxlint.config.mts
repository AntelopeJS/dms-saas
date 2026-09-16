import { defineConfig } from "oxlint";
import {
  ANTELOPE_IGNORE_PATTERNS,
  antelopePreset,
} from "@antelopejs/tooling-configs/oxc/lint";

/**
 * oxlint replaces `ignorePatterns` across `extends` rather than merging them,
 * so a package that adds patterns of its own has to spread this list back in.
 */
export const IGNORE_PATTERNS = ANTELOPE_IGNORE_PATTERNS;

export default defineConfig({
  extends: [
    antelopePreset({
      // Turned on repository-wide with the import-sorting pass, so the
      // reordering lands as one reviewable change everywhere at once.
      importSorting: false,
    }),
  ],
  ignorePatterns: [...IGNORE_PATTERNS],
  options: {
    typeAware: true,
    // Ceiling on the warning debt, so CI catches the new ones. Here rather
    // than in the lint script, so `lint:fix` and any direct oxlint run share
    // the same budget.
    maxWarnings: 0,
  },
});
