#!/usr/bin/env node
/**
 * Model-checks the guarded plan change of @antelopejs/dms-saas with TLC through
 * the shared runner of @antelopejs/tooling-configs: GuardedPlanChange.tla on a
 * healthy database, with database and Stripe calls that fail, and with two
 * operations racing a stale cancellation.
 *
 * With no argument it runs the CI configuration of each (`<config>.ci.cfg`);
 * with `--full` it runs the full one (`<config>.cfg`). Exits 0 when all match
 * the record in SKILL.md, 1 when a rule changed, and 2 when TLC could not run.
 * The runner exits on the first configuration that changed.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { checkSpec, EXIT } from "@antelopejs/tooling-configs/formal";

const dir = path.dirname(fileURLToPath(import.meta.url));

/** The findings of each configuration, with the states in TLC's shortest counterexample. */
const CONFIGS = {
  Healthy: {
    ci: { DeadlineStopsProviderEffect: 13 },
    full: { DeadlineStopsProviderEffect: 13 },
  },
  Faults: {
    ci: { DeadlineStopsProviderEffect: 13 },
    full: { DeadlineStopsProviderEffect: 13, AdmissionResumes: 50 },
  },
  Races: {
    ci: { DeadlineStopsProviderEffect: 13, AdmissionResumes: 27 },
    full: { DeadlineStopsProviderEffect: 13, AdmissionResumes: 28 },
  },
};

const args = process.argv.slice(2);
if (args.some((arg) => arg !== "--full")) {
  console.error("usage: node check.mjs [--full]");
  process.exit(EXIT.tool);
}
const mode = args.includes("--full") ? "full" : "ci";

for (const [config, findings] of Object.entries(CONFIGS)) {
  await checkSpec({
    dir,
    spec: "GuardedPlanChange",
    config: mode === "full" ? config : `${config}.ci`,
    findings: findings[mode],
  });
}
