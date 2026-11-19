import { antelopeFmtPreset } from "@antelopejs/tooling-configs/oxc/fmt";

/** Prettier formats the Vue layer; Markdown was never machine-formatted here; the journeys and their helpers keep their hand layout. */
export default antelopeFmtPreset({
  ignorePatterns: [
    "**/*.md",
    "packages/dms-saas/frontend-vue/**",
    "**/*.vue",
    "e2e/journeys/**",
    "e2e/*.mjs",
  ],
});
