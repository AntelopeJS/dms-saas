import { RUNNING_DEMO_MIGRATION_ID } from "./data/platform";

// The registry dms-saas keeps of the migrations an executor works on in this
// process (`src/workers/plan-migration.ts`): its resume pass marks a running
// migration missing from it as interrupted, on every start and reload.
const LIVE_EXECUTORS_KEY = Symbol.for(
  "@antelopejs/dms-saas/plan-migration-executors",
);

interface LiveExecutorsHost {
  [LIVE_EXECUTORS_KEY]?: Set<string>;
}

/**
 * Lists the seeded running migration as executing, so the playground always
 * shows a migration in progress. Nothing moves its workspaces: it stays at
 * the progress the seed wrote. Called before the database hooks run.
 */
export function keepDemoMigrationRunning(): void {
  const host = globalThis as LiveExecutorsHost;
  host[LIVE_EXECUTORS_KEY] ??= new Set();
  host[LIVE_EXECUTORS_KEY].add(RUNNING_DEMO_MIGRATION_ID);
}
