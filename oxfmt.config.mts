import { antelopeFmtPreset } from "@antelopejs/tooling-configs/oxc/fmt";

/** Shared across both packages; a package that adds patterns spreads this in. */
export const IGNORE_PATTERNS = ["**/*.md"];

export default antelopeFmtPreset({ ignorePatterns: [...IGNORE_PATTERNS] });
