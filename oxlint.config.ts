import { existsSync, readdirSync, realpathSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { defineConfig } from "oxlint";
import {
  ANTELOPE_IGNORE_PATTERNS,
  antelopePreset,
} from "@antelopejs/tooling-configs/oxc/lint";

const CLAUDE_SKILLS = resolve(".claude/skills");
const AGENT_SKILLS = resolve(".agents/skills");

/**
 * The `.claude/skills` links into `.agents/skills`. The lint already reads each
 * target under `.agents`, so through the link it would report every finding twice.
 */
const CLAUDE_SKILL_LINKS = existsSync(CLAUDE_SKILLS)
  ? readdirSync(CLAUDE_SKILLS, { withFileTypes: true })
      .filter((entry) => {
        const link = join(CLAUDE_SKILLS, entry.name);
        return (
          entry.isSymbolicLink() &&
          existsSync(link) &&
          realpathSync(link).startsWith(AGENT_SKILLS + sep)
        );
      })
      .flatMap((entry) => [
        `.claude/skills/${entry.name}`,
        `.claude/skills/${entry.name}/**`,
      ])
  : [];

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
    ...CLAUDE_SKILL_LINKS,
    "packages/dms-saas/frontend-vue/**",
  ],
  options: { typeAware: true, maxWarnings: 0 },
});
