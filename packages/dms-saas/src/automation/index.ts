import type { DataNodeType } from "@antelopejs/interface-dms-automation";
import { ACTIONS } from "./actions";
import { TRIGGERS } from "./triggers";

export * from "./events";

const AUTOMATION_INTERFACE_PACKAGE = "@antelopejs/interface-dms-automation";

type AutomationInterface =
  typeof import("@antelopejs/interface-dms-automation");

interface ModuleLoadError extends Error {
  code?: string;
}

const DATA_NODES: DataNodeType[] = [];

let automationInterfacePromise:
  | Promise<AutomationInterface | undefined>
  | undefined;

function isMissingAutomationInterface(error: ModuleLoadError): boolean {
  const firstLine = error.message.split("\n", 1)[0] ?? "";
  return (
    ["MODULE_NOT_FOUND", "ERR_MODULE_NOT_FOUND"].includes(error.code ?? "") &&
    (firstLine === `Cannot find module '${AUTOMATION_INTERFACE_PACKAGE}'` ||
      firstLine.startsWith(
        `Cannot find package '${AUTOMATION_INTERFACE_PACKAGE}' imported from `,
      ))
  );
}

async function loadAutomationInterface(): Promise<
  AutomationInterface | undefined
> {
  try {
    return await import("@antelopejs/interface-dms-automation");
  } catch (error) {
    if (error instanceof Error && isMissingAutomationInterface(error))
      return undefined;
    throw error;
  }
}

function getAutomationInterface(): Promise<AutomationInterface | undefined> {
  automationInterfacePromise ??= loadAutomationInterface();
  return automationInterfacePromise;
}

/**
 * Declares the saas automation node types when the optional automation
 * interface package is installed; without it, nothing is registered.
 */
export async function registerAutomationNodes(): Promise<void> {
  const automation = await getAutomationInterface();
  if (!automation) return;
  for (const trigger of TRIGGERS) automation.RegisterTriggerType(trigger);
  for (const action of ACTIONS) automation.RegisterActionType(action);
  for (const node of DATA_NODES) automation.RegisterDataNodeType(node);
}

/** Withdraws every node type {@link registerAutomationNodes} declared. */
export async function unregisterAutomationNodes(): Promise<void> {
  const automation = await getAutomationInterface();
  if (!automation) return;
  for (const trigger of TRIGGERS) automation.UnregisterTriggerType(trigger.id);
  for (const action of ACTIONS) automation.UnregisterActionType(action.id);
  for (const node of DATA_NODES) automation.UnregisterDataNodeType(node.id);
}
