import { AsyncLocalStorage } from "node:async_hooks";

/** The procedure run whose step is writing. */
export interface AutomationOrigin {
  procedureId: string;
  runId: string;
}

/**
 * Ports of an event a procedure's write caused; absent on an event a person,
 * Stripe, a cron or another module caused.
 */
export type AutomationOriginFields = {
  originProcedureId?: string;
  originRunId?: string;
};

const automationWrites = new AsyncLocalStorage<AutomationOrigin>();

/**
 * Runs the write an action step makes, so the saas events it causes carry
 * the procedure and the run that made it.
 */
export function runAsAutomation<T>(
  origin: AutomationOrigin,
  write: () => Promise<T>,
): Promise<T> {
  return automationWrites.run(
    { procedureId: origin.procedureId, runId: origin.runId },
    write,
  );
}

/** The origin ports of an event caused in this call chain. */
export function currentAutomationOrigin(): AutomationOriginFields {
  const origin = automationWrites.getStore();
  if (!origin) return {};
  return { originProcedureId: origin.procedureId, originRunId: origin.runId };
}
