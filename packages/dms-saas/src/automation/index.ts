import { createHash } from "node:crypto";
import {
  type ActionType,
  type JsonSchema,
  RegisterActionType,
  RegisterTriggerType,
  type TriggerType,
  UnregisterActionType,
  UnregisterTriggerType,
} from "@antelopejs/interface-dms-automation";
import {
  automationNotificationSubject,
  notifyTenantOwners,
} from "../notifications";
import {
  reactivateWorkspaceCommand,
  suspendWorkspaceCommand,
} from "../operator-actions";

export interface SubscriptionStartedEvent {
  tenantId: string;
  planId: string | null;
  status: string;
  stripeSubscriptionId: string;
  /**
   * False when the checkout was trialing but the internal trial-consumption
   * row could not be recorded (missing email/creator/plan, or already
   * recorded); workflows must not assume a usage row exists.
   */
  trialConsumptionRecorded: boolean;
  at: string;
}

export interface SubscriptionCancelledEvent {
  tenantId: string;
  stripeSubscriptionId: string;
  at: string;
}

export interface PaymentFailedEvent {
  tenantId: string;
  invoiceId: string;
  invoiceNumber: string | null;
  amountDue: number;
  currency: string;
  at: string;
}

export interface TrialEndingEvent {
  tenantId: string;
  trialEndsAt: string | null;
  at: string;
}

export interface TenantDeletedEvent {
  tenantId: string;
  at: string;
  /** Consumers must deduplicate non-idempotent effects by this identity on replay. */
  operationId?: string;
}

interface AutomationEventPayloads {
  "saas.subscription-started": SubscriptionStartedEvent;
  "saas.subscription-cancelled": SubscriptionCancelledEvent;
  "saas.payment-failed": PaymentFailedEvent;
  "saas.trial-ending": TrialEndingEvent;
  "saas.tenant-deleted": TenantDeletedEvent;
}

export type AutomationEventName = keyof AutomationEventPayloads;

type AutomationEventListener = (payload: unknown) => void | Promise<void>;

const eventListeners = new Map<
  AutomationEventName,
  Set<AutomationEventListener>
>();

function listenersFor(
  event: AutomationEventName,
): Set<AutomationEventListener> {
  const existing = eventListeners.get(event);
  if (existing) return existing;
  const created = new Set<AutomationEventListener>();
  eventListeners.set(event, created);
  return created;
}

/**
 * Broadcast a saas lifecycle event to the automation triggers listening for
 * it. No-ops when nothing listens and never throws, so emit call sites in
 * business flows are always safe.
 */
export function emitAutomationEvent<E extends AutomationEventName>(
  event: E,
  payload: AutomationEventPayloads[E],
): void {
  for (const listener of listenersFor(event)) {
    try {
      void Promise.resolve(listener(payload)).catch(() => undefined);
    } catch {
      // a failing procedure must never break the emitting business flow
    }
  }
}

/** Propagates deletion trigger failures; delivery may repeat and is not exactly-once execution. */
export async function emitTenantDeletedEvent(
  payload: TenantDeletedEvent,
): Promise<void> {
  for (const listener of listenersFor("saas.tenant-deleted"))
    await listener(payload);
}

const EMPTY_CONFIG_SCHEMA: JsonSchema = { type: "object", properties: {} };

const TENANT_ID_PROPERTY: JsonSchema = { type: "string" };
const AT_PROPERTY: JsonSchema = { type: "string" };

interface SaasEventTriggerSpec {
  event: AutomationEventName;
  name: string;
  description: string;
  icon: string;
  outputProperties: Record<string, JsonSchema>;
}

function createEventTrigger(spec: SaasEventTriggerSpec): TriggerType {
  return {
    id: spec.event,
    name: spec.name,
    description: spec.description,
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
      listenersFor(spec.event).delete(handle as AutomationEventListener);
    },
  };
}

const TRIGGERS: TriggerType[] = [
  createEventTrigger({
    event: "saas.subscription-started",
    name: "Subscription started",
    description:
      "Fires when a Stripe checkout completes and a workspace subscription becomes active or trialing",
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
    name: "Subscription cancelled",
    description: "Fires when a workspace subscription is cancelled in Stripe",
    icon: "i-ph-x-circle",
    outputProperties: {
      stripeSubscriptionId: { type: "string" },
    },
  }),
  createEventTrigger({
    event: "saas.payment-failed",
    name: "Payment failed",
    description:
      "Fires when an invoice payment fails and the workspace goes past due",
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
    name: "Trial ending",
    description: "Fires when a workspace trial is about to end",
    icon: "i-ph-hourglass",
    outputProperties: {
      trialEndsAt: { type: ["string", "null"] },
    },
  }),
  createEventTrigger({
    event: "saas.tenant-deleted",
    name: "Workspace deleted",
    description: "Fires when a workspace is deleted",
    icon: "i-ph-trash",
    outputProperties: { operationId: { type: "string" } },
  }),
];

interface SuspendWorkspaceInput {
  tenantId: string;
  suspended?: boolean;
}

interface SuspendWorkspaceOutput {
  tenantId: string;
  suspended: boolean;
}

function automationOperationId(runId: string, nodeId: string): string {
  const fingerprint = createHash("sha256")
    .update(`${runId}\u0000${nodeId}`)
    .digest("hex")
    .slice(0, 48);
  return `automation-${fingerprint}`;
}

const suspendWorkspaceAction: ActionType<
  SuspendWorkspaceInput,
  SuspendWorkspaceOutput
> = {
  id: "saas.suspend-workspace",
  name: "Suspend workspace",
  description:
    "Suspend a workspace (pause Stripe collection) or reactivate it when suspended is false",
  icon: "i-ph-prohibit",
  inputSchema: {
    type: "object",
    properties: {
      tenantId: { type: "string" },
      suspended: { type: "boolean", default: true },
    },
    required: ["tenantId"],
  },
  outputSchema: {
    type: "object",
    properties: {
      tenantId: { type: "string" },
      suspended: { type: "boolean" },
    },
  },
  async execute(input, ctx) {
    const suspended = input.suspended ?? true;
    const transition = suspended ? "suspending" : "reactivating";
    ctx.log("info", `${transition} workspace ${input.tenantId}`);
    const command = {
      tenantId: input.tenantId,
      operationId: automationOperationId(ctx.runId, ctx.nodeId),
      actor: {
        id: `automation:${ctx.procedureId}`,
        email: "automation@system.invalid",
      },
    };
    await (suspended
      ? suspendWorkspaceCommand(command)
      : reactivateWorkspaceCommand(command));
    return { tenantId: input.tenantId, suspended };
  },
};

interface NotifyTenantOwnersInput {
  tenantId: string;
  title: string;
  description: string;
  icon?: string;
  linkTo?: string;
}

interface NotifyTenantOwnersOutput {
  ok: boolean;
}

const DEFAULT_NOTIFICATION_ICON = "i-ph-bell";

const notifyTenantOwnersAction: ActionType<
  NotifyTenantOwnersInput,
  NotifyTenantOwnersOutput
> = {
  id: "saas.notify-tenant-owners",
  name: "Notify workspace owners",
  description: "Send an in-app notification to all owners of a workspace",
  icon: DEFAULT_NOTIFICATION_ICON,
  inputSchema: {
    type: "object",
    properties: {
      tenantId: { type: "string" },
      title: { type: "string" },
      description: { type: "string" },
      icon: { type: "string" },
      linkTo: { type: "string" },
    },
    required: ["tenantId", "title", "description"],
  },
  outputSchema: {
    type: "object",
    properties: { ok: { type: "boolean" } },
  },
  async execute(input) {
    await notifyTenantOwners(input.tenantId, automationNotificationSubject, {
      icon: input.icon ?? DEFAULT_NOTIFICATION_ICON,
      title: input.title,
      description: input.description,
      linkTo: input.linkTo,
    });
    return { ok: true };
  },
};

const ACTIONS: ActionType[] = [
  suspendWorkspaceAction,
  notifyTenantOwnersAction,
];

export function registerAutomationNodes(): void {
  for (const trigger of TRIGGERS) {
    RegisterTriggerType(trigger);
  }
  for (const action of ACTIONS) {
    RegisterActionType(action);
  }
}

export function unregisterAutomationNodes(): void {
  for (const trigger of TRIGGERS) {
    UnregisterTriggerType(trigger.id);
  }
  for (const action of ACTIONS) {
    UnregisterActionType(action.id);
  }
}
