import type {
  JsonSchema,
  TriggerType,
} from "@antelopejs/interface-dms-automation";
import { Logging } from "@antelopejs/interface-core/logging";
import type { z } from "zod";
import {
  type AutomationEventListener,
  type AutomationEventName,
  type AutomationEventPayloads,
  listenersFor,
} from "./events";
import { automationNodeLabels } from "./labels";

const STRING: JsonSchema = { type: "string" };

/** Settings a trigger reads, and which events they let through. */
export interface TriggerFilter<E extends AutomationEventName, C> {
  config: z.ZodType<C>;
  matches(config: C, payload: AutomationEventPayloads[E]): boolean;
}

interface SaasEventTriggerSpec<E extends AutomationEventName, C> {
  event: E;
  icon: string;
  configProperties?: Record<string, JsonSchema>;
  outputProperties: Record<string, JsonSchema>;
  filter?: TriggerFilter<E, C>;
  /** Logged once each time a procedure arms the trigger. */
  deprecationNotice?: string;
}

function createEventTrigger<E extends AutomationEventName, C = never>(
  spec: SaasEventTriggerSpec<E, C>,
): TriggerType {
  return {
    id: spec.event,
    ...automationNodeLabels("trigger", spec.event),
    icon: spec.icon,
    cluster: "replicated",
    configSchema: {
      type: "object",
      properties: { ...spec.configProperties },
    },
    outputSchema: {
      type: "object",
      properties: {
        tenantId: STRING,
        deliveryId: STRING,
        ...spec.outputProperties,
        at: STRING,
      },
    },
    async activate(config, emit) {
      if (spec.deprecationNotice)
        Logging.Warn(`[dms-saas:automation] ${spec.deprecationNotice}`);
      const { filter } = spec;
      const settings = filter?.config.parse(config ?? {});
      const listener: AutomationEventListener<E> = (payload) => {
        if (
          filter &&
          settings !== undefined &&
          !filter.matches(settings, payload)
        )
          return undefined;
        return emit(payload);
      };
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
    outputProperties: { operationId: STRING },
    deprecationNotice:
      "saas.tenant-deleted is deprecated; use dms.tenant-deleted",
  }),
];
