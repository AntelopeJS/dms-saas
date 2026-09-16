import {
  type SEGMENT_OPERATORS,
  TENANT_CUSTOMER_TYPES,
  TENANT_SUBSCRIPTION_STATUSES,
} from "../db";

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

export interface SegmentFieldDefinition {
  id: string;
  type: SegmentFieldType;
  valueKind: SegmentValueKind;
  /** i18n key for the label (no $ prefix). */
  labelKey: string;
  /** i18n key for the short description. */
  descriptionKey: string;
  operators: readonly (typeof SEGMENT_OPERATORS)[number][];
  /** Static enum values when type === "enum". */
  enumValues?: readonly string[];
  /** Optional display unit hint for the builder UI. */
  unit?: "currency" | "days" | "count";
}

const NUMBER_OPERATORS = ["eq", "neq", "gt", "gte", "lt", "lte"] as const;
const STRING_OPERATORS = ["eq", "neq", "contains"] as const;
const ENUM_OPERATORS = ["eq", "neq", "in", "nin"] as const;
const BOOLEAN_OPERATORS = ["eq"] as const;
const DATE_OPERATORS = ["gt", "gte", "lt", "lte"] as const;

export const SEGMENT_FIELDS: readonly SegmentFieldDefinition[] = [
  {
    id: "name",
    type: "string",
    valueKind: "string",
    labelKey: "saas.segments.fields.name.label",
    descriptionKey: "saas.segments.fields.name.description",
    operators: STRING_OPERATORS,
  },
  {
    id: "createdAt",
    type: "date",
    valueKind: "date",
    labelKey: "saas.segments.fields.created_at.label",
    descriptionKey: "saas.segments.fields.created_at.description",
    operators: DATE_OPERATORS,
  },
  {
    id: "ageInDays",
    type: "number",
    valueKind: "number",
    labelKey: "saas.segments.fields.age_in_days.label",
    descriptionKey: "saas.segments.fields.age_in_days.description",
    operators: NUMBER_OPERATORS,
    unit: "days",
  },
  {
    id: "planId",
    type: "enum:plan",
    valueKind: "string",
    labelKey: "saas.segments.fields.plan_id.label",
    descriptionKey: "saas.segments.fields.plan_id.description",
    operators: ENUM_OPERATORS,
  },
  {
    id: "mrr",
    type: "number",
    valueKind: "number",
    labelKey: "saas.segments.fields.mrr.label",
    descriptionKey: "saas.segments.fields.mrr.description",
    operators: NUMBER_OPERATORS,
    unit: "currency",
  },
  {
    id: "isPaying",
    type: "boolean",
    valueKind: "boolean",
    labelKey: "saas.segments.fields.is_paying.label",
    descriptionKey: "saas.segments.fields.is_paying.description",
    operators: BOOLEAN_OPERATORS,
  },
  {
    id: "status",
    type: "enum",
    valueKind: "string",
    labelKey: "saas.segments.fields.status.label",
    descriptionKey: "saas.segments.fields.status.description",
    operators: ENUM_OPERATORS,
    enumValues: TENANT_SUBSCRIPTION_STATUSES,
  },
  {
    id: "hasStripeCustomer",
    type: "boolean",
    valueKind: "boolean",
    labelKey: "saas.segments.fields.has_stripe_customer.label",
    descriptionKey: "saas.segments.fields.has_stripe_customer.description",
    operators: BOOLEAN_OPERATORS,
  },
  {
    id: "isOnTrial",
    type: "boolean",
    valueKind: "boolean",
    labelKey: "saas.segments.fields.is_on_trial.label",
    descriptionKey: "saas.segments.fields.is_on_trial.description",
    operators: BOOLEAN_OPERATORS,
  },
  {
    id: "customerType",
    type: "enum",
    valueKind: "string",
    labelKey: "saas.segments.fields.customer_type.label",
    descriptionKey: "saas.segments.fields.customer_type.description",
    operators: ENUM_OPERATORS,
    enumValues: TENANT_CUSTOMER_TYPES,
  },
  {
    id: "membersCount",
    type: "number",
    valueKind: "number",
    labelKey: "saas.segments.fields.members_count.label",
    descriptionKey: "saas.segments.fields.members_count.description",
    operators: NUMBER_OPERATORS,
    unit: "count",
  },
  {
    id: "totalRevenue",
    type: "number",
    valueKind: "number",
    labelKey: "saas.segments.fields.total_revenue.label",
    descriptionKey: "saas.segments.fields.total_revenue.description",
    operators: NUMBER_OPERATORS,
    unit: "currency",
  },
  {
    id: "daysSinceLastInvoice",
    type: "number",
    valueKind: "number",
    labelKey: "saas.segments.fields.days_since_last_invoice.label",
    descriptionKey: "saas.segments.fields.days_since_last_invoice.description",
    operators: NUMBER_OPERATORS,
    unit: "days",
  },
] as const;

export const USER_SEGMENT_FIELDS: readonly SegmentFieldDefinition[] = [
  {
    id: "email",
    type: "string",
    valueKind: "string",
    labelKey: "saas.segments.fields.user_email.label",
    descriptionKey: "saas.segments.fields.user_email.description",
    operators: STRING_OPERATORS,
  },
  {
    id: "name",
    type: "string",
    valueKind: "string",
    labelKey: "saas.segments.fields.user_name.label",
    descriptionKey: "saas.segments.fields.user_name.description",
    operators: STRING_OPERATORS,
  },
  {
    id: "language",
    type: "string",
    valueKind: "string",
    labelKey: "saas.segments.fields.user_language.label",
    descriptionKey: "saas.segments.fields.user_language.description",
    operators: STRING_OPERATORS,
  },
  {
    id: "createdAt",
    type: "date",
    valueKind: "date",
    labelKey: "saas.segments.fields.user_created_at.label",
    descriptionKey: "saas.segments.fields.user_created_at.description",
    operators: DATE_OPERATORS,
  },
  {
    id: "ageInDays",
    type: "number",
    valueKind: "number",
    labelKey: "saas.segments.fields.user_age_in_days.label",
    descriptionKey: "saas.segments.fields.user_age_in_days.description",
    operators: NUMBER_OPERATORS,
    unit: "days",
  },
  {
    id: "isValidated",
    type: "boolean",
    valueKind: "boolean",
    labelKey: "saas.segments.fields.user_is_validated.label",
    descriptionKey: "saas.segments.fields.user_is_validated.description",
    operators: BOOLEAN_OPERATORS,
  },
  {
    id: "daysSinceLastActive",
    type: "number",
    valueKind: "number",
    labelKey: "saas.segments.fields.days_since_last_active.label",
    descriptionKey: "saas.segments.fields.days_since_last_active.description",
    operators: NUMBER_OPERATORS,
    unit: "days",
  },
  {
    id: "workspacesCount",
    type: "number",
    valueKind: "number",
    labelKey: "saas.segments.fields.workspaces_count.label",
    descriptionKey: "saas.segments.fields.workspaces_count.description",
    operators: NUMBER_OPERATORS,
    unit: "count",
  },
  {
    id: "isOwnerOfAnyWorkspace",
    type: "boolean",
    valueKind: "boolean",
    labelKey: "saas.segments.fields.is_owner_of_any_workspace.label",
    descriptionKey:
      "saas.segments.fields.is_owner_of_any_workspace.description",
    operators: BOOLEAN_OPERATORS,
  },
] as const;

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
