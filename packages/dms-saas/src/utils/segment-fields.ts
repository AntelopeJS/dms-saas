import type { Tone } from "@antelopejs/interface-dms/base";
import {
  BILLING_STATES,
  type SEGMENT_OPERATORS,
  TENANT_CUSTOMER_TYPES,
} from "../db";
import { STATUS_TONES } from "./status-vocabulary";

/**
 * Which field catalog a condition is validated against: "user" at the root
 * of a segment, "workspace" inside a workspaceRef node.
 */
export type SegmentFieldCatalog = "workspace" | "user";

export type SegmentFieldType =
  | "string"
  | "number"
  | "boolean"
  | "date"
  | "enum"
  | "enum:plan";

export type SegmentValueKind = "string" | "number" | "boolean" | "date";

/** The heading a field is listed under in the builder's field picker. */
export type SegmentFieldGroup =
  | "identity"
  | "activity"
  | "memberships"
  | "workspace"
  | "billing";

/** One value of an enum field, named for people. */
export interface SegmentEnumOption {
  value: string;
  /** i18n key of the label (no `$` prefix). */
  labelKey: string;
  /** Tone of the value's pill, when the value is a status. */
  tone?: Tone;
}

type SegmentOperatorId = (typeof SEGMENT_OPERATORS)[number];

export interface SegmentFieldDefinition {
  id: string;
  type: SegmentFieldType;
  valueKind: SegmentValueKind;
  /** i18n key for the label (no $ prefix). */
  labelKey: string;
  /** i18n key for the short description. */
  descriptionKey: string;
  operators: readonly SegmentOperatorId[];
  /** Heading of the field in the picker. */
  group: SegmentFieldGroup;
  /** Icon of the field in the picker and in the rule. */
  icon: string;
  /** The values of an `enum` field, with their labels. */
  enumOptions?: readonly SegmentEnumOption[];
  /**
   * Display unit hint for the builder UI. Currency amounts are stored in
   * minor units, as the projections compute them.
   */
  unit?: "currency" | "days" | "count";
}

const NUMBER_OPERATORS = ["gt", "gte", "lt", "lte", "eq", "neq"] as const;
const STRING_OPERATORS = ["contains", "eq", "neq"] as const;
const ENUM_OPERATORS = ["in", "nin", "eq", "neq"] as const;
const BOOLEAN_OPERATORS = ["eq"] as const;
const DATE_OPERATORS = ["gt", "gte", "lt", "lte"] as const;

const OPERATORS_BY_KIND: Record<
  SegmentValueKind,
  readonly SegmentOperatorId[]
> = {
  string: STRING_OPERATORS,
  number: NUMBER_OPERATORS,
  boolean: BOOLEAN_OPERATORS,
  date: DATE_OPERATORS,
};

const FIELD_KEY_PREFIX = "saas.segments.fields";

interface FieldSpec {
  id: string;
  /** Segment of the i18n keys under `saas.segments.fields`. */
  key: string;
  type: SegmentFieldType;
  group: SegmentFieldGroup;
  icon: string;
  unit?: SegmentFieldDefinition["unit"];
  enumOptions?: readonly SegmentEnumOption[];
}

const VALUE_KIND_BY_TYPE: Record<SegmentFieldType, SegmentValueKind> = {
  string: "string",
  number: "number",
  boolean: "boolean",
  date: "date",
  enum: "string",
  "enum:plan": "string",
};

function defineField(spec: FieldSpec): SegmentFieldDefinition {
  const valueKind = VALUE_KIND_BY_TYPE[spec.type];
  const isEnum = spec.type === "enum" || spec.type === "enum:plan";
  return {
    id: spec.id,
    type: spec.type,
    valueKind,
    labelKey: `${FIELD_KEY_PREFIX}.${spec.key}.label`,
    descriptionKey: `${FIELD_KEY_PREFIX}.${spec.key}.description`,
    operators: isEnum ? ENUM_OPERATORS : OPERATORS_BY_KIND[valueKind],
    group: spec.group,
    icon: spec.icon,
    unit: spec.unit,
    enumOptions: spec.enumOptions,
  };
}

const BILLING_STATE_OPTIONS: readonly SegmentEnumOption[] = BILLING_STATES.map(
  (state) => ({
    value: state,
    labelKey: `saas.status.workspace.${state}`,
    tone: STATUS_TONES.workspace[state],
  }),
);

const CUSTOMER_TYPE_OPTIONS: readonly SegmentEnumOption[] =
  TENANT_CUSTOMER_TYPES.map((type) => ({
    value: type,
    labelKey: `saas.segments.enum.customer_type.${type}`,
  }));

const WORKSPACE_FIELD_SPECS: FieldSpec[] = [
  {
    id: "name",
    key: "name",
    type: "string",
    group: "workspace",
    icon: "i-ph-buildings",
  },
  {
    id: "createdAt",
    key: "created_at",
    type: "date",
    group: "workspace",
    icon: "i-ph-calendar-blank",
  },
  {
    id: "ageInDays",
    key: "age_in_days",
    type: "number",
    group: "workspace",
    icon: "i-ph-hourglass",
    unit: "days",
  },
  {
    id: "membersCount",
    key: "members_count",
    type: "number",
    group: "workspace",
    icon: "i-ph-users",
    unit: "count",
  },
  {
    id: "status",
    key: "status",
    type: "enum",
    group: "billing",
    icon: "i-ph-pulse",
    enumOptions: BILLING_STATE_OPTIONS,
  },
  {
    id: "planId",
    key: "plan_id",
    type: "enum:plan",
    group: "billing",
    icon: "i-ph-package",
  },
  {
    id: "isPaying",
    key: "is_paying",
    type: "boolean",
    group: "billing",
    icon: "i-ph-currency-circle-dollar",
  },
  {
    id: "isOnTrial",
    key: "is_on_trial",
    type: "boolean",
    group: "billing",
    icon: "i-ph-hourglass-medium",
  },
  {
    id: "mrr",
    key: "mrr",
    type: "number",
    group: "billing",
    icon: "i-ph-chart-line-up",
    unit: "currency",
  },
  {
    id: "totalRevenue",
    key: "total_revenue",
    type: "number",
    group: "billing",
    icon: "i-ph-coins",
    unit: "currency",
  },
  {
    id: "daysSinceLastInvoice",
    key: "days_since_last_invoice",
    type: "number",
    group: "billing",
    icon: "i-ph-receipt",
    unit: "days",
  },
  {
    id: "hasStripeCustomer",
    key: "has_stripe_customer",
    type: "boolean",
    group: "billing",
    icon: "i-ph-credit-card",
  },
  {
    id: "customerType",
    key: "customer_type",
    type: "enum",
    group: "billing",
    icon: "i-ph-identification-card",
    enumOptions: CUSTOMER_TYPE_OPTIONS,
  },
];

const USER_FIELD_SPECS: FieldSpec[] = [
  {
    id: "email",
    key: "user_email",
    type: "string",
    group: "identity",
    icon: "i-ph-envelope-simple",
  },
  {
    id: "name",
    key: "user_name",
    type: "string",
    group: "identity",
    icon: "i-ph-user",
  },
  {
    id: "language",
    key: "user_language",
    type: "string",
    group: "identity",
    icon: "i-ph-translate",
  },
  {
    id: "isValidated",
    key: "user_is_validated",
    type: "boolean",
    group: "identity",
    icon: "i-ph-seal-check",
  },
  {
    id: "createdAt",
    key: "user_created_at",
    type: "date",
    group: "activity",
    icon: "i-ph-calendar-blank",
  },
  {
    id: "ageInDays",
    key: "user_age_in_days",
    type: "number",
    group: "activity",
    icon: "i-ph-hourglass",
    unit: "days",
  },
  {
    id: "daysSinceLastActive",
    key: "days_since_last_active",
    type: "number",
    group: "activity",
    icon: "i-ph-clock",
    unit: "days",
  },
  {
    id: "workspacesCount",
    key: "workspaces_count",
    type: "number",
    group: "memberships",
    icon: "i-ph-buildings",
    unit: "count",
  },
  {
    id: "isOwnerOfAnyWorkspace",
    key: "is_owner_of_any_workspace",
    type: "boolean",
    group: "memberships",
    icon: "i-ph-crown-simple",
  },
];

/** Fields of a workspace, read inside a "user's workspaces" condition. */
export const SEGMENT_FIELDS: readonly SegmentFieldDefinition[] =
  WORKSPACE_FIELD_SPECS.map(defineField);

/** Fields of a user, read at the root of a segment. */
export const USER_SEGMENT_FIELDS: readonly SegmentFieldDefinition[] =
  USER_FIELD_SPECS.map(defineField);

export function getSegmentFields(
  catalog: SegmentFieldCatalog,
): readonly SegmentFieldDefinition[] {
  return catalog === "user" ? USER_SEGMENT_FIELDS : SEGMENT_FIELDS;
}

export function findSegmentField(
  fieldId: string,
  catalog: SegmentFieldCatalog,
): SegmentFieldDefinition | undefined {
  return getSegmentFields(catalog).find((f) => f.id === fieldId);
}

/**
 * Look a field up across both catalogs. Safe for value-kind resolution: ids
 * shared between catalogs (name, createdAt, ageInDays) have the same kind.
 */
export function findAnySegmentField(
  fieldId: string,
): SegmentFieldDefinition | undefined {
  return (
    findSegmentField(fieldId, "workspace") ?? findSegmentField(fieldId, "user")
  );
}
