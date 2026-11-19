import type { TestProject } from "vitest/node";
import { startRun } from "./run.ts";

declare module "vitest" {
  export interface ProvidedContext {
    /** The folder of the DMS run the journey tests drive. */
    dmsRun: string;
  }
}

/**
 * Starts one run of the verification playground for the journey tests: the
 * prepare commands (none with `DMS_E2E_PREBUILT=1`), its own MongoDB, a mail
 * sink, the backend and the built dashboard on free ports. Stops it once
 * every test has run.
 */
export default async function setup(
  project: TestProject,
): Promise<() => Promise<void>> {
  const { run, stop } = await startRun();
  project.provide("dmsRun", run.dir);
  return stop;
}
