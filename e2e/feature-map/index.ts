import { covers as backOfficeCovers } from "./back-office.ts";
import { covers as billingRulesCovers } from "./billing-rules.ts";
import { covers as gatingCovers } from "./gating.ts";
import { covers as interfaceCovers } from "./interface.ts";
import { covers as packageCovers } from "./package.ts";
import { covers as peopleCovers } from "./people.ts";
import { covers as plansCovers } from "./plans.ts";
import { covers as publicCovers } from "./public.ts";
import { covers as smokeCovers } from "./smoke.ts";
import { covers as webhooksCovers } from "./webhooks.ts";
import { covers as workspaceCovers } from "./workspace.ts";

/** The tracked files a feature of `e2e/journeys/` must cover: matched by a `userFacing` glob and by no `notUserFacing` glob. */
export const userFacing = [
  "packages/dms-saas/src/**",
  "packages/dms-saas/frontend-vue/**",
  "packages/dms-saas/skills/**",
  "packages/dms-saas/package.json",
  "packages/interface-dms-saas/src/**",
  "packages/interface-dms-saas/package.json",
];

/** The user-facing globs whose files no feature needs to cover. */
export const notUserFacing = [
  "packages/dms-saas/frontend-vue/.*",
  "packages/dms-saas/frontend-vue/eslint.config.mjs",
  "packages/dms-saas/frontend-vue/pnpm-lock.yaml",
];

/** The source globs each feature of `e2e/journeys/` owns, keyed by its journeys file name. */
export const covers = {
  "back-office": backOfficeCovers,
  "billing-rules": billingRulesCovers,
  gating: gatingCovers,
  interface: interfaceCovers,
  package: packageCovers,
  people: peopleCovers,
  plans: plansCovers,
  public: publicCovers,
  smoke: smokeCovers,
  webhooks: webhooksCovers,
  workspace: workspaceCovers,
} satisfies Record<string, readonly string[]>;
