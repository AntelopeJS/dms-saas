import { randomUUID } from "node:crypto";
import { executeOperatorAction, type OperatorActionRequest } from "./journal";
import type { OperatorActionDetails, WorkspaceOperatorAction } from "./types";

interface JournaledEffect<T> {
  action: WorkspaceOperatorAction;
  run: () => Promise<T>;
  detailsOf: (value: T) => OperatorActionDetails;
}

export async function runJournaled<T>(
  input: Pick<OperatorActionRequest, "tenantId" | "actor" | "details">,
  effect: JournaledEffect<T>,
): Promise<T> {
  const outcomes: T[] = [];
  await executeOperatorAction(
    { ...input, operationId: randomUUID(), action: effect.action },
    async (running) => {
      const value = await effect.run();
      outcomes.push(value);
      return {
        details: { ...running.details, ...effect.detailsOf(value) },
        effectiveAt: new Date(),
      };
    },
  );
  const [outcome] = outcomes;
  if (outcome === undefined) throw new Error("Journaled effect did not run");
  return outcome;
}
