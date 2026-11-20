import type {
  ActionType,
  JsonObject,
  JsonSchema,
} from "@antelopejs/interface-dms-automation";
import { z } from "zod";
import {
  BILLING_STATES,
  WORKSPACE_OWNER_STATUSES,
  WORKSPACE_RENEWAL_KINDS,
} from "../db";
import {
  asStep,
  ID_MAX_LENGTH,
  parseActionInput,
  requireWorkspace,
} from "./action-support";
import { automationNodeLabels } from "./labels";
import {
  listSegmentUsers,
  listWorkspaceDirectory,
  readPlanConstraints,
  readUpcomingInvoice,
  readWorkspaceBilling,
  readWorkspaceOwner,
} from "./reads";

const STRING: JsonSchema = { type: "string" };
const NULLABLE_STRING: JsonSchema = { type: ["string", "null"] };
const NUMBER: JsonSchema = { type: "number" };
const NULLABLE_NUMBER: JsonSchema = { type: ["number", "null"] };
const BOOLEAN: JsonSchema = { type: "boolean" };

const PAGE_DEFAULT = 50;
const PAGE_MAX = 200;

const tenantIdInput = z.string().trim().min(1).max(ID_MAX_LENGTH);
const workspaceInput = z.object({ tenantId: tenantIdInput });

const TENANT_INPUT_SCHEMA: JsonSchema = {
  type: "object",
  properties: {
    tenantId: {
      type: "string",
      maxLength: ID_MAX_LENGTH,
      description: "Workspace to read",
    },
  },
  required: ["tenantId"],
};

const PAGE_INPUT_PROPERTIES = {
  limit: {
    type: "integer",
    minimum: 1,
    maximum: PAGE_MAX,
    default: PAGE_DEFAULT,
    description: "Page size",
  },
  cursor: {
    type: "string",
    maxLength: ID_MAX_LENGTH,
    description: "nextCursor of the previous page",
  },
} satisfies Record<string, JsonSchema>;

const pageInput = {
  limit: z.number().int().min(1).max(PAGE_MAX).default(PAGE_DEFAULT),
  cursor: z.string().max(ID_MAX_LENGTH).optional(),
};

interface WorkspaceInput {
  tenantId: string;
}

/** A read of one workspace: no side effect, the tenant id checked. */
function workspaceRead<TOutput extends JsonObject>(
  id: string,
  icon: string,
  outputProperties: Record<string, JsonSchema>,
  read: (tenantId: string) => Promise<TOutput>,
  requiresWorkspace = true,
): ActionType<WorkspaceInput, TOutput> {
  return {
    id,
    ...automationNodeLabels("action", id),
    icon,
    sideEffects: false,
    inputSchema: TENANT_INPUT_SCHEMA,
    outputSchema: { type: "object", properties: outputProperties },
    execute: (input) =>
      asStep(id, async () => {
        const { tenantId } = parseActionInput(id, workspaceInput, input);
        if (requiresWorkspace) await requireWorkspace(tenantId);
        return read(tenantId);
      }),
  };
}

const getWorkspaceAction = workspaceRead(
  "saas.get-workspace",
  "i-ph-buildings",
  {
    found: {
      ...BOOLEAN,
      description:
        "False for an unknown or deleted workspace; every other port is then empty",
    },
    tenantId: STRING,
    name: NULLABLE_STRING,
    billingState: { type: ["string", "null"], enum: [...BILLING_STATES, null] },
    planId: NULLABLE_STRING,
    planName: NULLABLE_STRING,
    planInterval: { type: ["string", "null"], enum: ["month", "year", null] },
    planBillingMode: { type: ["string", "null"], enum: ["flat", "seat", null] },
    pendingPlanId: NULLABLE_STRING,
    isComplimentary: BOOLEAN,
    seats: { ...NUMBER, description: "Billed seats" },
    members: { ...NUMBER, description: "Members, support excluded" },
    mrrMinor: { ...NUMBER, description: "Normalised MRR, minor units" },
    currency: NULLABLE_STRING,
    renewalKind: {
      type: ["string", "null"],
      enum: [...WORKSPACE_RENEWAL_KINDS, null],
    },
    renewsAt: NULLABLE_STRING,
    stateSince: NULLABLE_STRING,
    ownerStatus: { type: "string", enum: [...WORKSPACE_OWNER_STATUSES] },
  },
  readWorkspaceBilling,
  false,
);

const getWorkspaceOwnerAction = workspaceRead(
  "saas.get-workspace-owner",
  "i-ph-user-circle",
  {
    found: {
      ...BOOLEAN,
      description:
        "True when a joined owner or a pending owner invitation exists",
    },
    status: { type: "string", enum: [...WORKSPACE_OWNER_STATUSES] },
    userId: { ...NULLABLE_STRING, description: "Null for an invitee" },
    name: NULLABLE_STRING,
    email: { ...NULLABLE_STRING, description: "Owner or invitee e-mail" },
    language: { ...NULLABLE_STRING, description: "For localized mail" },
  },
  readWorkspaceOwner,
);

const getPlanConstraintsAction = workspaceRead(
  "saas.get-plan-constraints",
  "i-ph-gauge",
  {
    found: {
      ...BOOLEAN,
      description: "False when the workspace has no subscription",
    },
    planId: NULLABLE_STRING,
    planName: NULLABLE_STRING,
    maxMembers: {
      ...NULLABLE_NUMBER,
      description: "Seat cap; -1 is unlimited",
    },
    occupiedSeats: {
      ...NUMBER,
      description: "Members plus unexpired invitations, support excluded",
    },
    seatsAvailable: { ...NULLABLE_NUMBER, description: "Null when unlimited" },
    features: {
      type: "object",
      description:
        "Feature values of the plan, by feature id, inheritance applied",
    },
    pendingPlanId: NULLABLE_STRING,
    pendingPlanName: NULLABLE_STRING,
    effectiveAt: NULLABLE_STRING,
    blocked: BOOLEAN,
    admissionBlocked: BOOLEAN,
    incompatibilityCodes: { type: "array", items: STRING },
  },
  readPlanConstraints,
);

const getUpcomingInvoiceAction = workspaceRead(
  "saas.get-upcoming-invoice",
  "i-ph-calendar-dots",
  {
    status: { type: "string", enum: ["available", "absent", "unavailable"] },
    reason: NULLABLE_STRING,
    currency: NULLABLE_STRING,
    amountDueMinor: NULLABLE_NUMBER,
    totalMinor: NULLABLE_NUMBER,
    subtotalMinor: NULLABLE_NUMBER,
    taxMinor: NULLABLE_NUMBER,
    billingDate: NULLABLE_STRING,
    periodStart: NULLABLE_STRING,
    periodEnd: NULLABLE_STRING,
    lineCount: NUMBER,
    computedAt: STRING,
  },
  readUpcomingInvoice,
);

interface ListWorkspacesInput {
  billingState?: string;
  planId?: string;
  isComplimentary?: boolean;
  renewalKind?: string;
  renewsBefore?: string;
  limit?: number;
  cursor?: string;
}

const LIST_WORKSPACES_ACTION_ID = "saas.list-workspaces";

const listWorkspacesInput = z.object({
  billingState: z.enum(BILLING_STATES).optional(),
  planId: z.string().max(ID_MAX_LENGTH).optional(),
  isComplimentary: z.boolean().optional(),
  renewalKind: z.enum(WORKSPACE_RENEWAL_KINDS).optional(),
  renewsBefore: z.string().datetime({ offset: true }).optional(),
  ...pageInput,
});

const WORKSPACE_ITEM: JsonSchema = {
  type: "object",
  properties: {
    tenantId: STRING,
    name: NULLABLE_STRING,
    billingState: STRING,
    planId: NULLABLE_STRING,
    planName: NULLABLE_STRING,
    isComplimentary: BOOLEAN,
    seats: NUMBER,
    mrrMinor: NUMBER,
    currency: NULLABLE_STRING,
    renewalKind: NULLABLE_STRING,
    renewsAt: NULLABLE_STRING,
  },
};

const listWorkspacesAction: ActionType<ListWorkspacesInput, JsonObject> = {
  id: LIST_WORKSPACES_ACTION_ID,
  ...automationNodeLabels("action", LIST_WORKSPACES_ACTION_ID),
  icon: "i-ph-list-bullets",
  sideEffects: false,
  inputSchema: {
    type: "object",
    properties: {
      billingState: { type: "string", enum: [...BILLING_STATES] },
      planId: { type: "string", maxLength: ID_MAX_LENGTH },
      isComplimentary: BOOLEAN,
      renewalKind: { type: "string", enum: [...WORKSPACE_RENEWAL_KINDS] },
      renewsBefore: {
        type: "string",
        format: "date-time",
        description: "Only workspaces renewing before this date",
      },
      ...PAGE_INPUT_PROPERTIES,
    },
  },
  outputSchema: {
    type: "object",
    properties: {
      workspaces: { type: "array", items: WORKSPACE_ITEM },
      tenantIds: { type: "array", items: STRING },
      count: NUMBER,
      nextCursor: NULLABLE_STRING,
    },
  },
  execute: (input) =>
    asStep(LIST_WORKSPACES_ACTION_ID, async () => {
      const { limit, cursor, renewsBefore, ...filters } = parseActionInput(
        LIST_WORKSPACES_ACTION_ID,
        listWorkspacesInput,
        input,
      );
      const page = await listWorkspaceDirectory(
        {
          ...filters,
          renewsBefore: renewsBefore ? new Date(renewsBefore) : undefined,
        },
        limit,
        cursor,
      );
      return {
        workspaces: page.items,
        tenantIds: page.items.map((item) => item.tenantId),
        count: page.items.length,
        nextCursor: page.nextCursor,
      };
    }),
};

interface ListSegmentUsersInput {
  segmentId: string;
  limit?: number;
  cursor?: string;
}

const LIST_SEGMENT_USERS_ACTION_ID = "saas.list-segment-users";

const listSegmentUsersInput = z.object({
  segmentId: z.string().trim().min(1).max(ID_MAX_LENGTH),
  ...pageInput,
});

const listSegmentUsersAction: ActionType<ListSegmentUsersInput, JsonObject> = {
  id: LIST_SEGMENT_USERS_ACTION_ID,
  ...automationNodeLabels("action", LIST_SEGMENT_USERS_ACTION_ID),
  icon: "i-ph-users-three",
  sideEffects: false,
  inputSchema: {
    type: "object",
    properties: {
      segmentId: { type: "string", maxLength: ID_MAX_LENGTH },
      ...PAGE_INPUT_PROPERTIES,
    },
    required: ["segmentId"],
  },
  outputSchema: {
    type: "object",
    properties: {
      found: { ...BOOLEAN, description: "False for an unknown segment" },
      segmentName: NULLABLE_STRING,
      evaluatedAt: {
        ...NULLABLE_STRING,
        description: "When the membership was last evaluated",
      },
      total: { ...NUMBER, description: "Members of the published evaluation" },
      users: {
        type: "array",
        description:
          "One page of members with their e-mail, name and language; this contact data appears in the run trace",
        items: {
          type: "object",
          properties: {
            userId: STRING,
            email: STRING,
            name: NULLABLE_STRING,
            language: NULLABLE_STRING,
          },
        },
      },
      userIds: { type: "array", items: STRING },
      count: NUMBER,
      nextCursor: NULLABLE_STRING,
    },
  },
  execute: (input) =>
    asStep(LIST_SEGMENT_USERS_ACTION_ID, async () => {
      const { segmentId, limit, cursor } = parseActionInput(
        LIST_SEGMENT_USERS_ACTION_ID,
        listSegmentUsersInput,
        input,
      );
      const { items, ...page } = await listSegmentUsers(
        segmentId,
        limit,
        cursor,
      );
      return {
        ...page,
        users: items,
        userIds: items.map((item) => item.userId),
        count: items.length,
      };
    }),
};

/** The saas actions that only read. */
export const READ_ACTIONS: ActionType[] = [
  getWorkspaceAction,
  getWorkspaceOwnerAction,
  getPlanConstraintsAction,
  getUpcomingInvoiceAction,
  listWorkspacesAction,
  listSegmentUsersAction,
];
