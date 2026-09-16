import base, { IGNORE_PATTERNS } from "../../oxfmt.config.mts";

export default {
  ...base,
  ignorePatterns: [...IGNORE_PATTERNS, "frontend-vue/**", "**/*.vue"],
};
