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
import { BILLING_STATES, CREDIT_NOTE_TYPES, REFUND_STATUSES } from "../db";
import { automationNodeLabels } from "./labels";

const STRING: JsonSchema = { type: "string" };
const NULLABLE_STRING: JsonSchema = { type: ["string", "null"] };
const NUMBER: JsonSchema = { type: "number" };
const BOOLEAN: JsonSchema = { type: "boolean" };

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
  createEventTrigger({
    event: "saas.invoice-paid",
    icon: "i-ph-receipt",
    configProperties: {
      includeZeroAmount: {
        type: "boolean",
        default: false,
        description:
          "Also fire for invoices with nothing paid (trial start, 100% coupon)",
      },
    },
    outputProperties: {
      invoiceId: STRING,
      invoiceNumber: NULLABLE_STRING,
      amountPaid: NUMBER,
      currency: STRING,
      billingReason: NULLABLE_STRING,
      hostedInvoiceUrl: NULLABLE_STRING,
      reactivated: BOOLEAN,
    },
    filter: {
      config: z.object({ includeZeroAmount: z.boolean().optional() }),
      matches: (config, payload) =>
        config.includeZeroAmount === true || payload.amountPaid > 0,
    },
  }),
  createEventTrigger({
    event: "saas.credit-note-issued",
    icon: "i-ph-receipt-x",
    outputProperties: {
      creditNoteId: STRING,
      number: STRING,
      invoiceId: STRING,
      invoiceNumber: NULLABLE_STRING,
      amount: NUMBER,
      currency: STRING,
      type: { type: "string", enum: [...CREDIT_NOTE_TYPES] },
      reason: NULLABLE_STRING,
      refundId: NULLABLE_STRING,
      pdfUrl: NULLABLE_STRING,
    },
  }),
  createEventTrigger({
    event: "saas.refund-updated",
    icon: "i-ph-arrow-u-up-left",
    configProperties: {
      status: {
        type: "string",
        enum: [...REFUND_STATUSES],
        description: "Fire only for this status",
      },
    },
    outputProperties: {
      refundId: STRING,
      status: { type: "string", enum: [...REFUND_STATUSES] },
      amount: NUMBER,
      currency: STRING,
      failureReason: NULLABLE_STRING,
      creditNoteId: NULLABLE_STRING,
      chargeId: STRING,
    },
    filter: {
      config: z.object({ status: z.enum(REFUND_STATUSES).optional() }),
      matches: (config, payload) =>
        !config.status || config.status === payload.status,
    },
  }),
  createEventTrigger({
    event: "saas.workspace-deletion-requested",
    icon: "i-ph-trash-simple",
    outputProperties: {
      requestedBy: STRING,
      planId: NULLABLE_STRING,
      hadStripeSubscription: BOOLEAN,
      retentionDays: NUMBER,
      deletesAfter: STRING,
    },
  }),
  createEventTrigger({
    event: "saas.free-access-ending",
    icon: "i-ph-hourglass-medium",
    outputProperties: {
      freeUntil: STRING,
      planId: NULLABLE_STRING,
      daysLeft: NUMBER,
    },
  }),
];
