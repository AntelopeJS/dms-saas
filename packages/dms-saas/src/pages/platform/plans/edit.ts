import { PageController, RegisterPage } from "@antelopejs/interface-dms/page";
import { Form } from "@antelopejs/interface-dms/base";
import { CustomComponent } from "@antelopejs/interface-dms/base/custom";
import { DefaultDataTypes } from "@antelopejs/interface-dms/base/data-types/default-types";
import type { FormField } from "@antelopejs/interface-dms/base/form";
import { HttpMethod } from "@antelopejs/interface-dms/base/types/http";
import { SaasPlansController } from "./index";

const PLANS_ENDPOINT = "/api/saas/plans";
const PLANS_PAGE_URL = "/modules/saas/catalog/plans";

const PLAN_AUDIENCE_OPTIONS = [
  { label: "$saas.plans.audience.any", value: "any" },
  { label: "$saas.plans.audience.individual", value: "individual" },
  { label: "$saas.plans.audience.business", value: "business" },
];

const PLAN_INTERVAL_OPTIONS = [
  { label: "$saas.plans.interval.month", value: "month" },
  { label: "$saas.plans.interval.year", value: "year" },
];

const PLAN_BILLING_MODE_OPTIONS = [
  { label: "$saas.plans.billing_mode.flat", value: "flat" },
  { label: "$saas.plans.billing_mode.seat", value: "seat" },
];

const PLAN_CURRENCY_OPTIONS = [
  { label: "EUR (€)", value: "EUR" },
  { label: "USD ($)", value: "USD" },
];

const NAME_MAX_LENGTH = 100;
const DESCRIPTION_TEXTAREA_ROWS = 3;
const BORDER_LABEL_MAX_LENGTH = 50;
const DEFAULT_MAX_MEMBERS = -1;
const DEFAULT_BORDER_COLOR_PLACEHOLDER = "#3b82f6";

const BASIC_INFO_FIELDS: FormField[] = [
  {
    id: "name",
    label: "$saas.plans.field.name",
    description: "$saas.plans.field.name_description",
    type: new DefaultDataTypes.StringType({ maxLength: NAME_MAX_LENGTH }),
    required: true,
  },
  {
    id: "description",
    label: "$saas.plans.field.description",
    description: "$saas.plans.field.description_description",
    type: new DefaultDataTypes.StringType({
      textarea: true,
      rows: DESCRIPTION_TEXTAREA_ROWS,
    }),
  },
  {
    id: "audience",
    label: "$saas.plans.field.audience",
    description: "$saas.plans.field.audience_description",
    type: new DefaultDataTypes.SelectType({ items: PLAN_AUDIENCE_OPTIONS }),
    required: true,
    defaultValue: "any",
  },
];

const PRICING_FIELDS: FormField[] = [
  {
    id: "price",
    label: "$saas.plans.field.price",
    description: "$saas.plans.field.price_description",
    type: new DefaultDataTypes.PriceType({ min: 0 }),
    required: true,
  },
  {
    id: "currency",
    label: "$saas.plans.field.currency",
    description: "$saas.plans.field.currency_description",
    type: new DefaultDataTypes.SelectType({ items: PLAN_CURRENCY_OPTIONS }),
    required: true,
    defaultValue: "EUR",
  },
  {
    id: "interval",
    label: "$saas.plans.field.interval",
    description: "$saas.plans.field.interval_description",
    type: new DefaultDataTypes.SelectType({ items: PLAN_INTERVAL_OPTIONS }),
    required: true,
    defaultValue: "month",
  },
  {
    id: "billingMode",
    label: "$saas.plans.field.billing_mode",
    description: "$saas.plans.field.billing_mode_description",
    type: new DefaultDataTypes.SelectType({ items: PLAN_BILLING_MODE_OPTIONS }),
    required: true,
    defaultValue: "flat",
  },
  {
    id: "trialDays",
    label: "$saas.plans.field.trial_days",
    description: "$saas.plans.field.trial_days_description",
    type: new DefaultDataTypes.NumberType({ min: 0 }),
    defaultValue: 0,
  },
];

const INHERITANCE_FIELD: FormField = {
  id: "inheritance",
  label: "$saas.plans.field.inheritance",
  description: "$saas.plans.field.inheritance_description",
  type: new DefaultDataTypes.StringType(),
  inputComponent: CustomComponent("DmsSaasPlanInheritancePicker")
    .options({
      catalogUrl: `${PLANS_ENDPOINT}/catalog`,
      permissionsTreeUrl: `${PLANS_ENDPOINT}/permissions-tree`,
    })
    .serializeSync(),
};

const OPTIONS_FIELDS: FormField[] = [
  {
    id: "maxMembers",
    label: "$saas.plans.field.max_members",
    description: "$saas.plans.field.max_members_description",
    type: new DefaultDataTypes.NumberType({ min: -1 }),
    defaultValue: DEFAULT_MAX_MEMBERS,
  },
  {
    id: "isActive",
    label: "$saas.plans.field.is_active",
    description: "$saas.plans.field.is_active_description",
    type: new DefaultDataTypes.BooleanType(),
    defaultValue: true,
  },
  {
    id: "isPublic",
    label: "$saas.plans.field.is_public",
    description: "$saas.plans.field.is_public_description",
    type: new DefaultDataTypes.BooleanType(),
    defaultValue: true,
  },
  {
    id: "isContactOnly",
    label: "$saas.plans.field.is_contact_only",
    description: "$saas.plans.field.is_contact_only_description",
    type: new DefaultDataTypes.BooleanType(),
    defaultValue: false,
  },
  {
    id: "order",
    label: "$saas.plans.field.order",
    description: "$saas.plans.field.order_description",
    type: new DefaultDataTypes.NumberType({ min: 0 }),
    defaultValue: 0,
  },
];

const DISPLAY_FIELDS: FormField[] = [
  {
    id: "borderColor",
    label: "$saas.plans.field.border_color",
    description: "$saas.plans.field.border_color_description",
    type: new DefaultDataTypes.ColorType({
      placeholder: DEFAULT_BORDER_COLOR_PLACEHOLDER,
    }),
  },
  {
    id: "borderLabel",
    label: "$saas.plans.field.border_label",
    description: "$saas.plans.field.border_label_description",
    type: new DefaultDataTypes.StringType({
      maxLength: BORDER_LABEL_MAX_LENGTH,
    }),
  },
];

const PLAN_FORM_FIELDS: FormField[] = [
  ...BASIC_INFO_FIELDS,
  ...PRICING_FIELDS,
  INHERITANCE_FIELD,
  ...OPTIONS_FIELDS,
  ...DISPLAY_FIELDS,
];

@RegisterPage()
export class SaasPlanNewController extends PageController("new", {
  displayName: "$saas.plans.new_title",
  description: "$saas.plans.new_description",
  category: SaasPlansController,
  icon: "i-ph-plus",
  hidden: true,
}) {
  static form = Form({
    title: "$saas.plans.new_title",
    fields: PLAN_FORM_FIELDS,
    submitUrl: PLANS_ENDPOINT,
    submitUrlMethod: HttpMethod.post,
    redirectOnSuccess: PLANS_PAGE_URL,
  });
}

@RegisterPage()
export class SaasPlanEditController extends PageController("edit", {
  displayName: "$saas.plans.edit_title",
  description: "$saas.plans.edit_description",
  category: SaasPlansController,
  urlSlug: ":id/edit",
  icon: "i-ph-pencil",
  hidden: true,
}) {
  static form = Form({
    title: "$saas.plans.edit_title",
    fields: PLAN_FORM_FIELDS,
    fetchUrl: `${PLANS_ENDPOINT}/{{params.id}}`,
    submitUrl: `${PLANS_ENDPOINT}/{{params.id}}`,
    submitUrlMethod: HttpMethod.put,
    redirectOnSuccess: PLANS_PAGE_URL,
  });
}
