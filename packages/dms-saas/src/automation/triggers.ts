import type {
  JsonSchema,
  TriggerType,
} from "@antelopejs/interface-dms-automation";
import {
  type AutomationEventListener,
  type AutomationEventName,
  listenersFor,
} from "./events";
import { automationNodeLabels } from "./labels";

const EMPTY_CONFIG_SCHEMA: JsonSchema = { type: "object", properties: {} };

const TENANT_ID_PROPERTY: JsonSchema = { type: "string" };
const AT_PROPERTY: JsonSchema = { type: "string" };

interface SaasEventTriggerSpec {
  event: AutomationEventName;
  icon: string;
  outputProperties: Record<string, JsonSchema>;
}

function createEventTrigger(spec: SaasEventTriggerSpec): TriggerType {
  return {
    id: spec.event,
    ...automationNodeLabels("trigger", spec.event),
    icon: spec.icon,
    cluster: "replicated",
    configSchema: EMPTY_CONFIG_SCHEMA,
    outputSchema: {
      type: "object",
      properties: {
        tenantId: TENANT_ID_PROPERTY,
        ...spec.outputProperties,
        at: AT_PROPERTY,
      },
    },
    async activate(_config, emit) {
      const listener: AutomationEventListener = (payload) => emit(payload);
      listenersFor(spec.event).add(listener);
      return listener;
    },
    async deactivate(handle) {
      const listeners = listenersFor(spec.event);
      const listener = [...listeners].find((candidate) => candidate === handle);
      if (listener) listeners.delete(listener);
    },
  };
}

export const TRIGGERS: TriggerType[] = [
  createEventTrigger({
    event: "saas.subscription-started",
    icon: "i-ph-rocket-launch",
    outputProperties: {
      planId: { type: ["string", "null"] },
      status: { type: "string" },
      stripeSubscriptionId: { type: "string" },
      trialConsumptionRecorded: { type: "boolean" },
    },
  }),
  createEventTrigger({
    event: "saas.subscription-cancelled",
    icon: "i-ph-x-circle",
    outputProperties: {
      stripeSubscriptionId: { type: "string" },
    },
  }),
  createEventTrigger({
    event: "saas.payment-failed",
    icon: "i-ph-warning-circle",
    outputProperties: {
      invoiceId: { type: "string" },
      invoiceNumber: { type: ["string", "null"] },
      amountDue: { type: "number" },
      currency: { type: "string" },
    },
  }),
  createEventTrigger({
    event: "saas.trial-ending",
    icon: "i-ph-hourglass",
    outputProperties: {
      trialEndsAt: { type: ["string", "null"] },
    },
  }),
  createEventTrigger({
    event: "saas.tenant-deleted",
    icon: "i-ph-trash",
    outputProperties: { operationId: { type: "string" } },
  }),
];
