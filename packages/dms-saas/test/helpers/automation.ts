import { randomUUID } from "node:crypto";
import { ImplementInterface } from "@antelopejs/interface-core";
import { onTestFinished } from "vitest";
import {
  type ActionType,
  type DataNodeType,
  type ExecutionCtx,
  internal,
  type JsonObject,
  type JsonValue,
  type TriggerType,
} from "@antelopejs/interface-dms-automation";

/** The node types modules registered with the automation module, by id. */
export interface AutomationCatalog {
  triggers: Map<string, TriggerType>;
  actions: Map<string, ActionType>;
  dataNodes: Map<string, DataNodeType>;
}

/**
 * Stands in for the automation module behind
 * `@antelopejs/interface-dms-automation`: its registering proxies keep each
 * trigger, action and data node type registered through them, by id, until it
 * is unregistered. Registrations made before the call are replayed into it.
 */
export function implementAutomationCatalog(): AutomationCatalog {
  const catalog: AutomationCatalog = {
    triggers: new Map(),
    actions: new Map(),
    dataNodes: new Map(),
  };
  ImplementInterface(internal, {
    RegisterTriggerType: {
      register: (id, type) => catalog.triggers.set(id, type),
      unregister: (id) => catalog.triggers.delete(id),
    },
    RegisterActionType: {
      register: (id, type) => catalog.actions.set(id, type),
      unregister: (id) => catalog.actions.delete(id),
    },
    RegisterDataNodeType: {
      register: (id, type) => catalog.dataNodes.set(id, type),
      unregister: (id) => catalog.dataNodes.delete(id),
    },
  });
  return catalog;
}

/** The trigger type registered under `id`; throws when none is. */
export function registeredTrigger(
  catalog: AutomationCatalog,
  id: string,
): TriggerType {
  const trigger = catalog.triggers.get(id);
  if (!trigger) throw new Error(`No trigger type is registered as ${id}`);
  return trigger;
}

/**
 * Arms the trigger registered under `id` with `config`, as a procedure
 * would, until the test finishes; resolves with the payloads it emits.
 */
export async function armTrigger(
  catalog: AutomationCatalog,
  id: string,
  config: JsonObject = {},
): Promise<JsonValue[]> {
  const trigger = registeredTrigger(catalog, id);
  const payloads: JsonValue[] = [];
  const handle = await trigger.activate(config, (payload) => {
    payloads.push(payload);
  });
  onTestFinished(() => trigger.deactivate(handle));
  return payloads;
}

/** The action type registered under `id`; throws when none is. */
export function registeredAction(
  catalog: AutomationCatalog,
  id: string,
): ActionType {
  const action = catalog.actions.get(id);
  if (!action) throw new Error(`No action type is registered as ${id}`);
  return action;
}

/** A step's execution context, as the automation runtime hands it. */
export function executionCtx(
  overrides: Partial<ExecutionCtx> = {},
): ExecutionCtx {
  return {
    procedureId: "procedure-1",
    runId: randomUUID(),
    nodeId: "node-1",
    log: () => undefined,
    ...overrides,
  };
}
