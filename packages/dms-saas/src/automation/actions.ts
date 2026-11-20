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
  resolveTenantOwners,
} from "../notifications";
import {
  PLATFORM_NOTE_TARGET_TYPES,
  PlatformNoteModel,
  TENANT_SUBSCRIPTION_STATUSES,
  type TenantSubscriptionStatus,
} from "../db";
import {
  AUTOMATION_AUTHOR_PREFIX,
  addPlatformNote,
  assertPlatformNoteTarget,
  PLATFORM_NOTE_MAX_LENGTH,
} from "../platform-notes/service";
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
import { runAsAutomation } from "./origin";
import { READ_ACTIONS } from "./read-actions";

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
  const result = await runAsAutomation(ctx, () =>
    setWorkspaceSuspendedCommand(
      { tenantId: request.tenantId, operationId, actor: automationActor(ctx) },
      request.suspended,
    ),
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
  idempotencyKey?: string;
}

type NotifyTenantOwnersOutput = {
  ok: boolean;
  recipientCount: number;
};

const DEFAULT_NOTIFICATION_ICON = "i-ph-bell";
const TITLE_MAX_LENGTH = 200;
const DESCRIPTION_MAX_LENGTH = 2000;
const ICON_MAX_LENGTH = 100;
const LINK_MAX_LENGTH = 2000;
const IDEMPOTENCY_KEY_MAX_LENGTH = 200;

const notifyTenantOwnersInput = z.object({
  tenantId: tenantIdInput,
  title: z.string().min(1).max(TITLE_MAX_LENGTH),
  description: z.string().min(1).max(DESCRIPTION_MAX_LENGTH),
  icon: z.string().max(ICON_MAX_LENGTH).default(DEFAULT_NOTIFICATION_ICON),
  linkTo: z.string().max(LINK_MAX_LENGTH).optional(),
  idempotencyKey: z.string().max(IDEMPOTENCY_KEY_MAX_LENGTH).optional(),
});

type OwnerNotification = z.infer<typeof notifyTenantOwnersInput>;

/**
 * The notification's event id: per node and key when the procedure wires a
 * key, else per run, node and content, so every for-each iteration has its own.
 */
function ownerNotificationEventId(
  notification: OwnerNotification,
  ctx: ExecutionCtx,
): string {
  if (notification.idempotencyKey)
    return `${NOTIFY_TENANT_OWNERS_ACTION_ID}:${ctx.procedureId}:${ctx.nodeId}:${notification.idempotencyKey}`;
  const fingerprint = createHash("sha256")
    .update(
      [ctx.runId, ctx.nodeId, notification.tenantId, notification.title].join(
        "\u0000",
      ),
    )
    .digest("hex");
  return `${NOTIFY_TENANT_OWNERS_ACTION_ID}:${fingerprint}`;
}

async function parseOwnerNotification(
  input: NotifyTenantOwnersInput,
): Promise<OwnerNotification> {
  const notification = parseActionInput(
    NOTIFY_TENANT_OWNERS_ACTION_ID,
    notifyTenantOwnersInput,
    input,
  );
  await requireWorkspace(notification.tenantId);
  return notification;
}

async function sendOwnerNotification(
  input: NotifyTenantOwnersInput,
  ctx: ExecutionCtx,
): Promise<NotifyTenantOwnersOutput> {
  const notification = await parseOwnerNotification(input);
  const recipientCount = await notifyTenantOwners(
    notification.tenantId,
    automationNotificationSubject,
    {
      icon: notification.icon,
      title: notification.title,
      description: notification.description,
      linkTo: notification.linkTo,
      eventId: ownerNotificationEventId(notification, ctx),
    },
  );
  return { ok: true, recipientCount };
}

async function countOwnerRecipients(
  input: NotifyTenantOwnersInput,
  ctx: ExecutionCtx,
): Promise<NotifyTenantOwnersOutput> {
  const notification = await parseOwnerNotification(input);
  const owners = await resolveTenantOwners(notification.tenantId);
  ctx.log("info", `test run: ${owners.length} owner(s) not notified`);
  return { ok: true, recipientCount: owners.length };
}

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
      tenantId: { type: "string", maxLength: ID_MAX_LENGTH },
      title: { type: "string", minLength: 1, maxLength: TITLE_MAX_LENGTH },
      description: {
        type: "string",
        minLength: 1,
        maxLength: DESCRIPTION_MAX_LENGTH,
      },
      icon: { type: "string", maxLength: ICON_MAX_LENGTH },
      linkTo: { type: "string", maxLength: LINK_MAX_LENGTH },
      idempotencyKey: {
        type: "string",
        maxLength: IDEMPOTENCY_KEY_MAX_LENGTH,
        description:
          "Wire a trigger's deliveryId: a step run again with the same key notifies no one twice",
      },
    },
    required: ["tenantId", "title", "description"],
  },
  outputSchema: {
    type: "object",
    properties: {
      ok: { type: "boolean" },
      recipientCount: { type: "number" },
    },
  },
  dryRun: (input, ctx) =>
    asStep(NOTIFY_TENANT_OWNERS_ACTION_ID, () =>
      countOwnerRecipients(input, ctx),
    ),
  execute: (input, ctx) =>
    asStep(NOTIFY_TENANT_OWNERS_ACTION_ID, () =>
      sendOwnerNotification(input, ctx),
    ),
};

interface AddPlatformNoteInput {
  targetType?: string;
  targetId: string;
  content: string;
  idempotencyKey?: string;
}

type AddPlatformNoteOutput = {
  noteId: string;
  created: boolean;
};

const ADD_PLATFORM_NOTE_ACTION_ID = "saas.add-platform-note";

const addPlatformNoteInput = z.object({
  targetType: z.enum(PLATFORM_NOTE_TARGET_TYPES).default("workspace"),
  targetId: tenantIdInput,
  content: z.string().trim().min(1).max(PLATFORM_NOTE_MAX_LENGTH),
  idempotencyKey: z.string().max(IDEMPOTENCY_KEY_MAX_LENGTH).optional(),
});

type AutomationNote = z.infer<typeof addPlatformNoteInput>;

/**
 * The note's id: per node, key and target when the procedure wires a key,
 * else per run, node, target and content, so a retried step writes no second
 * note and every for-each iteration writes its own.
 */
function automationNoteId(note: AutomationNote, ctx: ExecutionCtx): string {
  const parts = note.idempotencyKey
    ? [
        ADD_PLATFORM_NOTE_ACTION_ID,
        ctx.procedureId,
        ctx.nodeId,
        note.idempotencyKey,
        note.targetType,
        note.targetId,
      ]
    : [ctx.runId, ctx.nodeId, note.targetType, note.targetId, note.content];
  return createHash("sha256").update(parts.join("\u0000")).digest("hex");
}

async function parseAutomationNote(
  input: AddPlatformNoteInput,
): Promise<AutomationNote> {
  const note = parseActionInput(
    ADD_PLATFORM_NOTE_ACTION_ID,
    addPlatformNoteInput,
    input,
  );
  await assertPlatformNoteTarget(note.targetType, note.targetId);
  return note;
}

async function writeAutomationNote(
  input: AddPlatformNoteInput,
  ctx: ExecutionCtx,
): Promise<AddPlatformNoteOutput> {
  const note = await parseAutomationNote(input);
  const { note: stored, created } = await runAsAutomation(ctx, () =>
    addPlatformNote({
      targetType: note.targetType,
      targetId: note.targetId,
      authorId: `${AUTOMATION_AUTHOR_PREFIX}${ctx.procedureId}`,
      content: note.content,
      noteId: automationNoteId(note, ctx),
    }),
  );
  return { noteId: stored._id, created };
}

async function simulateAutomationNote(
  input: AddPlatformNoteInput,
  ctx: ExecutionCtx,
): Promise<AddPlatformNoteOutput> {
  const note = await parseAutomationNote(input);
  const noteId = automationNoteId(note, ctx);
  const existing = await GetModel(PlatformNoteModel).get(noteId);
  ctx.log("info", "test run: note not written");
  return { noteId, created: !existing };
}

const addPlatformNoteAction: ActionType<
  AddPlatformNoteInput,
  AddPlatformNoteOutput
> = {
  id: ADD_PLATFORM_NOTE_ACTION_ID,
  ...automationNodeLabels("action", ADD_PLATFORM_NOTE_ACTION_ID),
  icon: "i-ph-note-pencil",
  inputSchema: {
    type: "object",
    properties: {
      targetType: {
        type: "string",
        enum: [...PLATFORM_NOTE_TARGET_TYPES],
        default: "workspace",
        description: "What the note is about",
      },
      targetId: {
        type: "string",
        maxLength: ID_MAX_LENGTH,
        description: "Workspace id (wire tenantId) or user id",
      },
      content: {
        type: "string",
        minLength: 1,
        maxLength: PLATFORM_NOTE_MAX_LENGTH,
        description: "Plain text, visible to platform operators only",
      },
      idempotencyKey: {
        type: "string",
        maxLength: IDEMPOTENCY_KEY_MAX_LENGTH,
        description:
          "Wire a trigger's deliveryId: a step run again with the same key writes no second note",
      },
    },
    required: ["targetId", "content"],
  },
  outputSchema: {
    type: "object",
    properties: {
      noteId: { type: "string" },
      created: {
        type: "boolean",
        description: "False when the same step already wrote the note",
      },
    },
  },
  dryRun: (input, ctx) =>
    asStep(ADD_PLATFORM_NOTE_ACTION_ID, () =>
      simulateAutomationNote(input, ctx),
    ),
  execute: (input, ctx) =>
    asStep(ADD_PLATFORM_NOTE_ACTION_ID, () => writeAutomationNote(input, ctx)),
};

export const ACTIONS: ActionType[] = [
  suspendWorkspaceAction,
  notifyTenantOwnersAction,
  addPlatformNoteAction,
  ...READ_ACTIONS,
];
