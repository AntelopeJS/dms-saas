import { antelopeFmtPreset } from "@antelopejs/tooling-configs/oxc/fmt";

/** Prettier formats the Vue layer; Markdown was never machine-formatted here. */
export default antelopeFmtPreset({
  ignorePatterns: ["**/*.md", "packages/dms-saas/frontend-vue/**", "**/*.vue"],
});
