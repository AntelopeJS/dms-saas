import { createHash } from "node:crypto";
import type { ActionType } from "@antelopejs/interface-dms-automation";
import {
  automationNotificationSubject,
  notifyTenantOwners,
} from "../notifications";
import {
  reactivateWorkspaceCommand,
  suspendWorkspaceCommand,
} from "../operator-actions";
import { automationNodeLabels } from "./labels";

interface SuspendWorkspaceInput {
  tenantId: string;
  suspended?: boolean;
}

type SuspendWorkspaceOutput = {
  tenantId: string;
  suspended: boolean;
};

const SUSPEND_WORKSPACE_ACTION_ID = "saas.suspend-workspace";
const NOTIFY_TENANT_OWNERS_ACTION_ID = "saas.notify-tenant-owners";

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
  id: SUSPEND_WORKSPACE_ACTION_ID,
  ...automationNodeLabels("action", SUSPEND_WORKSPACE_ACTION_ID),
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

type NotifyTenantOwnersOutput = {
  ok: boolean;
};

const DEFAULT_NOTIFICATION_ICON = "i-ph-bell";

const notifyTenantOwnersAction: ActionType<
  NotifyTenantOwnersInput,
  NotifyTenantOwnersOutput
> = {
  id: NOTIFY_TENANT_OWNERS_ACTION_ID,
  ...automationNodeLabels("action", NOTIFY_TENANT_OWNERS_ACTION_ID),
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

export const ACTIONS: ActionType[] = [
  suspendWorkspaceAction,
  notifyTenantOwnersAction,
];
