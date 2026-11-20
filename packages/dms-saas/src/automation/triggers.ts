import type {
  JsonSchema,
  TriggerType,
} from "@antelopejs/interface-dms-automation";
import { Logging } from "@antelopejs/interface-core/logging";
import { z } from "zod";
import {
  type AutomationEventListener,
  type AutomationEventName,
  type AutomationEventPayloads,
  listenersFor,
} from "./events";
import { BILLING_STATES } from "../db";
import { automationNodeLabels } from "./labels";

const STRING: JsonSchema = { type: "string" };
const NULLABLE_STRING: JsonSchema = { type: ["string", "null"] };
const NUMBER: JsonSchema = { type: "number" };

const PLAN_DIRECTIONS = ["upgrade", "downgrade"] as const;

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
  /**
   * A procedure's write can cause the event: the trigger then ignores such
   * events unless armed with `includeAutomationWrites`, and outputs the
   * origin ports.
   */
  automationWrites?: boolean;
  /** Logged once each time a procedure arms the trigger. */
  deprecationNotice?: string;
}

const automationWritesSetting = z.object({
  includeAutomationWrites: z.boolean().optional(),
});

const AUTOMATION_WRITES_CONFIG = {
  includeAutomationWrites: {
    type: "boolean",
    default: false,
    description:
      "Also fire for changes a procedure made. Off by default, so a procedure does not answer its own writes.",
  },
} satisfies Record<string, JsonSchema>;

const ORIGIN_OUTPUTS = {
  originProcedureId: {
    type: "string",
    description: "Procedure whose write caused the event; absent otherwise",
  },
  originRunId: {
    type: "string",
    description: "Run of that procedure; absent otherwise",
  },
} satisfies Record<string, JsonSchema>;

function createEventTrigger<E extends AutomationEventName, C = never>(
  spec: SaasEventTriggerSpec<E, C>,
): TriggerType {
  const configProperties = {
    ...spec.configProperties,
  };
  const outputProperties = {
    tenantId: STRING,
    deliveryId: STRING,
    ...spec.outputProperties,
    at: STRING,
  };
  if (spec.automationWrites) {
    Object.assign(configProperties, AUTOMATION_WRITES_CONFIG);
    Object.assign(outputProperties, ORIGIN_OUTPUTS);
  }
  return {
    id: spec.event,
    ...automationNodeLabels("trigger", spec.event),
    icon: spec.icon,
    cluster: "replicated",
    configSchema: { type: "object", properties: configProperties },
    outputSchema: { type: "object", properties: outputProperties },
    async activate(config, emit) {
      if (spec.deprecationNotice)
        Logging.Warn(`[dms-saas:automation] ${spec.deprecationNotice}`);
      const { filter } = spec;
      const settings = filter?.config.parse(config ?? {});
      const includesAutomationWrites =
        automationWritesSetting.parse(config ?? {}).includeAutomationWrites ===
        true;
      const listener: AutomationEventListener<E> = (payload) => {
        if (
          payload.originProcedureId !== undefined &&
          !includesAutomationWrites
        )
          return undefined;
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
      source: { type: "string", enum: ["checkout", "provisioning"] },
      planId: { type: ["string", "null"] },
      status: { type: "string", enum: ["active", "trialing"] },
      stripeSubscriptionId: { type: "string" },
      trialConsumptionRecorded: { type: "boolean" },
    },
  }),
  createEventTrigger({
    event: "saas.subscription-cancelled",
    icon: "i-ph-x-circle",
    outputProperties: {
      source: { type: "string", enum: ["stripe", "workspace_deletion"] },
      stripeSubscriptionId: { type: ["string", "null"] },
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
  createEventTrigger({
    event: "saas.billing-state-changed",
    icon: "i-ph-arrows-left-right",
    automationWrites: true,
    configProperties: {
      toState: {
        type: "string",
        enum: [...BILLING_STATES],
        description: "Fire only for transitions into this state",
      },
      fromState: {
        type: "string",
        enum: [...BILLING_STATES],
        description: "Fire only for transitions out of this state",
      },
    },
    outputProperties: {
      fromState: { type: "string", enum: [...BILLING_STATES] },
      toState: { type: "string", enum: [...BILLING_STATES] },
      planId: NULLABLE_STRING,
      planName: NULLABLE_STRING,
      mrrMinor: NUMBER,
      previousMrrMinor: NUMBER,
      currency: NULLABLE_STRING,
    },
    filter: {
      config: z.object({
        toState: z.enum(BILLING_STATES).optional(),
        fromState: z.enum(BILLING_STATES).optional(),
      }),
      matches: (config, payload) =>
        (!config.toState || config.toState === payload.toState) &&
        (!config.fromState || config.fromState === payload.fromState),
    },
  }),
  createEventTrigger({
    event: "saas.plan-changed",
    icon: "i-ph-swap",
    configProperties: {
      direction: {
        type: "string",
        enum: [...PLAN_DIRECTIONS],
        description: "Fire only in this direction",
      },
    },
    outputProperties: {
      fromPlanId: NULLABLE_STRING,
      toPlanId: NULLABLE_STRING,
      fromPlanName: NULLABLE_STRING,
      toPlanName: NULLABLE_STRING,
      direction: { type: "string", enum: [...PLAN_DIRECTIONS] },
      billingState: { type: "string", enum: [...BILLING_STATES] },
    },
    filter: {
      config: z.object({ direction: z.enum(PLAN_DIRECTIONS).optional() }),
      matches: (config, payload) =>
        !config.direction || config.direction === payload.direction,
    },
  }),
];
