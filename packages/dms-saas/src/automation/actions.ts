import { createHash } from "node:crypto";
import { GetModel } from "@antelopejs/interface-database-decorators";
import type {
  ActionType,
  ExecutionCtx,
} from "@antelopejs/interface-dms-automation";
import { z } from "zod";
import {
  automationNotificationSubject,
  notifyTenantOwners,
} from "../notifications";
import {
  TENANT_SUBSCRIPTION_STATUSES,
  type TenantSubscriptionStatus,
} from "../db";
import {
  type OperatorActor,
  setWorkspaceSuspendedCommand,
} from "../operator-actions";
import { OperatorActionModel } from "../operator-actions/db/operator-action.model";
import { checkSuspensionTransition } from "../workspaces/suspension";
import {
  asStep,
  ID_MAX_LENGTH,
  parseActionInput,
  requireWorkspace,
} from "./action-support";
import { automationNodeLabels } from "./labels";

interface SuspendWorkspaceInput {
  tenantId: string;
  suspended?: boolean;
}

type SuspendWorkspaceOutput = {
  tenantId: string;
  suspended: boolean;
  subscriptionStatus: TenantSubscriptionStatus;
  changed: boolean;
  operationId: string;
  effectiveAt: string | null;
};

const SUSPEND_WORKSPACE_ACTION_ID = "saas.suspend-workspace";
const NOTIFY_TENANT_OWNERS_ACTION_ID = "saas.notify-tenant-owners";

const tenantIdInput = z.string().trim().min(1).max(ID_MAX_LENGTH);

const suspendWorkspaceInput = z.object({
  tenantId: tenantIdInput,
  suspended: z.boolean().default(true),
});

type SuspensionRequest = z.infer<typeof suspendWorkspaceInput>;

function automationOperationId(
  ctx: ExecutionCtx,
  request: SuspensionRequest,
): string {
  const fingerprint = createHash("sha256")
    .update(
      [
        ctx.runId,
        ctx.nodeId,
        request.tenantId,
        request.suspended ? "suspend" : "unsuspend",
      ].join("\u0000"),
    )
    .digest("hex")
    .slice(0, 48);
  return `automation-${fingerprint}`;
}

function automationActor(ctx: ExecutionCtx): OperatorActor {
  return {
    id: `automation:${ctx.procedureId}`,
    email: "automation@system.invalid",
  };
}

async function parseSuspensionRequest(
  input: SuspendWorkspaceInput,
): Promise<SuspensionRequest> {
  const request = parseActionInput(
    SUSPEND_WORKSPACE_ACTION_ID,
    suspendWorkspaceInput,
    input,
  );
  await requireWorkspace(request.tenantId);
  return request;
}

function unchangedOutput(
  request: SuspensionRequest,
  operationId: string,
  status: TenantSubscriptionStatus,
): SuspendWorkspaceOutput {
  return {
    tenantId: request.tenantId,
    suspended: status === "suspended",
    subscriptionStatus: status,
    changed: false,
    operationId,
    effectiveAt: null,
  };
}

async function runSuspension(
  input: SuspendWorkspaceInput,
  ctx: ExecutionCtx,
): Promise<SuspendWorkspaceOutput> {
  const request = await parseSuspensionRequest(input);
  const operationId = automationOperationId(ctx, request);
  const recorded = await GetModel(OperatorActionModel).get(operationId);
  if (!recorded) {
    const check = await checkSuspensionTransition(
      request.tenantId,
      request.suspended,
    );
    if (!check.changed)
      return unchangedOutput(request, operationId, check.status);
  }
  ctx.log(
    "info",
    `${request.suspended ? "suspending" : "reactivating"} workspace ${request.tenantId}`,
  );
  const result = await setWorkspaceSuspendedCommand(
    { tenantId: request.tenantId, operationId, actor: automationActor(ctx) },
    request.suspended,
  );
  return {
    tenantId: request.tenantId,
    suspended: result.subscriptionStatus === "suspended",
    subscriptionStatus: result.subscriptionStatus,
    changed: true,
    operationId: result.operationId,
    effectiveAt: result.effectiveAt?.toISOString() ?? null,
  };
}

async function simulateSuspension(
  input: SuspendWorkspaceInput,
  ctx: ExecutionCtx,
): Promise<SuspendWorkspaceOutput> {
  const request = await parseSuspensionRequest(input);
  const check = await checkSuspensionTransition(
    request.tenantId,
    request.suspended,
  );
  ctx.log("info", "test run: workspace not suspended");
  return {
    tenantId: request.tenantId,
    suspended: request.suspended,
    subscriptionStatus: request.suspended ? "suspended" : "active",
    changed: check.changed,
    operationId: automationOperationId(ctx, request),
    effectiveAt: null,
  };
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
      tenantId: { type: "string", maxLength: ID_MAX_LENGTH },
      suspended: { type: "boolean", default: true },
    },
    required: ["tenantId"],
  },
  outputSchema: {
    type: "object",
    properties: {
      tenantId: { type: "string" },
      suspended: { type: "boolean" },
      subscriptionStatus: {
        type: "string",
        enum: [...TENANT_SUBSCRIPTION_STATUSES],
      },
      changed: { type: "boolean" },
      operationId: { type: "string" },
      effectiveAt: { type: ["string", "null"] },
    },
  },
  dryRun: (input, ctx) =>
    asStep(SUSPEND_WORKSPACE_ACTION_ID, () => simulateSuspension(input, ctx)),
  execute: (input, ctx) =>
    asStep(SUSPEND_WORKSPACE_ACTION_ID, () => runSuspension(input, ctx)),
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
