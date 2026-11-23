#!/usr/bin/env node
/**
 * Model-checks the creation gate of a workspace registration of
 * @antelopejs/dms-saas with TLC through the shared runner of
 * @antelopejs/tooling-configs: WorkspaceCreationGate.tla under the code of
 * today (`Healthy`), under the code before AntelopeJS/dms-saas#261
 * (`Before261`) and under each half of that fix alone (`ClaimGuardOnly`,
 * `RetryOnly`), and past the bound of `Healthy` (`ThreeTicks`).
 *
 * Exits 0 when every rule matches the record in SKILL.md, 1 when a rule
 * changed, and 2 when TLC could not run. The runner exits on the first
 * configuration that changed.
 *
 * @module
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { checkSpec, EXIT } from "@antelopejs/tooling-configs/formal";

const dir = path.dirname(fileURLToPath(import.meta.url));

/** The findings of each configuration, with the states in TLC's shortest counterexample. */
const CONFIGS = {
  Healthy: {},
  Before261: { NoClaimOfHeldGate: 4, DecisionNotLost: 7, NoStuckGate: 11 },
  ClaimGuardOnly: { DecisionNotLost: 11 },
  RetryOnly: { NoClaimOfHeldGate: 4, NoStuckGate: 14 },
  ThreeTicks: { DecisionNotLost: 31 },
};

if (process.argv.length > 2) {
  console.error("usage: node check.mjs");
  process.exit(EXIT.tool);
}

for (const [config, findings] of Object.entries(CONFIGS)) {
  await checkSpec({ dir, spec: "WorkspaceCreationGate", config, findings });
}
