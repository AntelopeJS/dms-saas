import { defineConfig } from "oxlint";
import base, { IGNORE_PATTERNS } from "../../oxlint.config.mts";

export default defineConfig({
  extends: [base],
  // Front-end sources, which oxlint cannot lint yet: they move with the
  // front-end migration.
  ignorePatterns: [...IGNORE_PATTERNS, "frontend-vue/**"],
  overrides: [
    {
      files: ["test/**"],
      rules: {
        // A `describe` block is not a function anyone splits, and an integration
        // suite's length is its coverage. These ceilings are about code someone has
        // to hold in their head at once, which is not what a test file asks of a
        // reader.
        "eslint/max-lines": "off",
        "eslint/max-lines-per-function": "off",
        // vitest's own idioms trip this: `expect(model.method)` and
        // `vi.mocked(model.method)` reference a method to assert on it or to
        // stub it, never to call it detached. typescript-eslint ships a
        // separate jest-aware rule for exactly this reason; oxlint has none.
        "typescript/unbound-method": "off",
        // The fixtures are object literals cast to a model type, so the
        // "class instance" the rule sees spread has no prototype to lose.
        "typescript/no-misused-spread": "off",
        // Same root cause: a double assertion is how a partial fixture reaches
        // a model type it does not structurally satisfy, and a helper that
        // JSON-encodes whatever a case hands it takes `object`. Building full
        // instances instead would test the fixture.
        "anti-slop/no-chained-type-assertions": "off",
        "anti-slop/no-object-parameters": "off",
      },
    },
  ],
});
