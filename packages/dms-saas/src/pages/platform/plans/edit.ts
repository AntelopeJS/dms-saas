import { PageController, RegisterPage } from "@antelopejs/interface-dms/page";
import { Form, Grid, GridRow } from "@antelopejs/interface-dms/base";
import { CustomComponent } from "@antelopejs/interface-dms/base/custom";
import { DefaultDataTypes } from "@antelopejs/interface-dms/base/data-types/default-types";
import type {
  FormField,
  FormSection,
} from "@antelopejs/interface-dms/base/form";
import { DefaultLayout } from "@antelopejs/interface-dms/base/layouts";
import { HttpMethod } from "@antelopejs/interface-dms/base/types/http";
import {
  PLAN_AUDIENCES,
  PLAN_BILLING_MODES,
  PLAN_INTERVALS,
} from "../../../db";
import { PlanAccessType } from "../../../plans/plan-access-type";
import { PLANS_PAGE_URL, SaasPlansController } from "./index";

const PLANS_ENDPOINT = "/api/saas/plans";
const TEXTS = "$saas.catalog.editor";
const PLAN_TEXTS = "$saas.catalog.plans";
const PERMISSIONS = "$saas.permissions.catalog";
const FORM_KEY = "form";

const NAME_MAX_LENGTH = 100;
const DESCRIPTION_TEXTAREA_ROWS = 2;
const BADGE_MAX_LENGTH = 50;
const UNLIMITED_MEMBERS = -1;
const DEFAULT_BADGE_COLOR_PLACEHOLDER = "#3b82f6";
const PLAN_CURRENCIES = ["EUR", "USD"] as const;
const FORM_COLUMN_SPAN = 2;

const AUDIENCE_OPTIONS = PLAN_AUDIENCES.map((value) => ({
  label: `${PLAN_TEXTS}.audience.${value}`,
  value,
}));

const INTERVAL_OPTIONS = PLAN_INTERVALS.map((value) => ({
  label: `${PLAN_TEXTS}.interval.${value}`,
  value,
}));

const BILLING_MODE_OPTIONS = PLAN_BILLING_MODES.map((value) => ({
  label: `${PLAN_TEXTS}.billing_mode.${value}`,
  description: `${TEXTS}.billing_mode_hint.${value}`,
  value,
}));

const CURRENCY_OPTIONS = PLAN_CURRENCIES.map((value) => ({
  label: value,
  value,
}));

const IDENTITY_FIELDS: FormField[] = [
  {
    id: "name",
    label: `${TEXTS}.field.name`,
    description: `${TEXTS}.field.name_description`,
    type: new DefaultDataTypes.StringType({ maxLength: NAME_MAX_LENGTH }),
    required: true,
  },
  {
    id: "description",
    label: `${TEXTS}.field.description`,
    description: `${TEXTS}.field.description_description`,
    type: new DefaultDataTypes.StringType({
      textarea: true,
      rows: DESCRIPTION_TEXTAREA_ROWS,
    }),
  },
  {
    id: "audience",
    label: `${TEXTS}.field.audience`,
    description: `${TEXTS}.field.audience_description`,
    type: new DefaultDataTypes.SelectType({
      items: AUDIENCE_OPTIONS,
      display: "segmented",
    }),
    required: true,
    defaultValue: "any",
  },
];

const PRICING_FIELDS: FormField[] = [
  {
    id: "price",
    label: `${TEXTS}.field.price`,
    description: `${TEXTS}.field.price_description`,
    hint: `${TEXTS}.field.price_hint`,
    type: new DefaultDataTypes.PriceType({ min: 0 }),
    required: true,
  },
  {
    id: "currency",
    label: `${TEXTS}.field.currency`,
    type: new DefaultDataTypes.SelectType({
      items: CURRENCY_OPTIONS,
      display: "segmented",
    }),
    required: true,
    defaultValue: "EUR",
  },
  {
    id: "interval",
    label: `${TEXTS}.field.interval`,
    type: new DefaultDataTypes.SelectType({
      items: INTERVAL_OPTIONS,
      display: "segmented",
    }),
    required: true,
    defaultValue: "month",
  },
  {
    id: "billingMode",
    label: `${TEXTS}.field.billing_mode`,
    description: `${TEXTS}.field.billing_mode_description`,
    type: new DefaultDataTypes.SelectType({
      items: BILLING_MODE_OPTIONS,
      display: "cards",
    }),
    required: true,
    defaultValue: "flat",
  },
  {
    id: "trialDays",
    label: `${TEXTS}.field.trial_days`,
    description: `${TEXTS}.field.trial_days_description`,
    type: new DefaultDataTypes.NumberType({ min: 0, step: 1 }),
  },
];

const ACCESS_FIELDS: FormField[] = [
  {
    id: "inheritance",
    label: `${TEXTS}.field.access`,
    description: `${TEXTS}.field.access_description`,
    type: new PlanAccessType({
      catalogUrl: `${PLANS_ENDPOINT}/catalog`,
      permissionsTreeUrl: `${PLANS_ENDPOINT}/permissions-tree`,
    }),
  },
];

// No `defaultValue` on the cap, the trial or the price: the form would offer
// "Module default: -1" under them. A plan saved without a cap is unlimited.
const LIMIT_FIELDS: FormField[] = [
  {
    id: "maxMembers",
    label: `${TEXTS}.field.max_members`,
    description: `${TEXTS}.field.max_members_description`,
    type: new DefaultDataTypes.NumberType({ min: UNLIMITED_MEMBERS }),
    inputComponent: CustomComponent("DmsSaasPlanLimitInput")
      .options({ unit: `${TEXTS}.field.members_unit` })
      .serializeSync(),
  },
];

const VISIBILITY_FIELDS: FormField[] = [
  {
    id: "isActive",
    label: `${TEXTS}.field.is_active`,
    description: `${TEXTS}.field.is_active_description`,
    type: new DefaultDataTypes.BooleanType(),
    defaultValue: true,
  },
  {
    id: "isPublic",
    label: `${TEXTS}.field.is_public`,
    description: `${TEXTS}.field.is_public_description`,
    type: new DefaultDataTypes.BooleanType(),
    defaultValue: true,
  },
  {
    id: "order",
    label: `${TEXTS}.field.order`,
    description: `${TEXTS}.field.order_description`,
    type: new DefaultDataTypes.NumberType({ min: 0, step: 1 }),
  },
  {
    id: "borderLabel",
    label: `${TEXTS}.field.badge`,
    description: `${TEXTS}.field.badge_description`,
    type: new DefaultDataTypes.StringType({ maxLength: BADGE_MAX_LENGTH }),
  },
  {
    id: "borderColor",
    label: `${TEXTS}.field.badge_color`,
    description: `${TEXTS}.field.badge_color_description`,
    type: new DefaultDataTypes.ColorType({
      placeholder: DEFAULT_BADGE_COLOR_PLACEHOLDER,
    }),
  },
];

const PLAN_SECTIONS: FormSection[] = [
  {
    id: "identity",
    label: `${TEXTS}.section.identity`,
    description: `${TEXTS}.section.identity_description`,
    icon: "i-ph-identification-card",
    fields: IDENTITY_FIELDS,
  },
  {
    id: "pricing",
    label: `${TEXTS}.section.pricing`,
    description: `${TEXTS}.section.pricing_description`,
    icon: "i-ph-currency-circle-dollar",
    fields: PRICING_FIELDS,
  },
  {
    id: "access",
    label: `${TEXTS}.section.access`,
    description: `${TEXTS}.section.access_description`,
    icon: "i-ph-key",
    fields: ACCESS_FIELDS,
  },
  {
    id: "limits",
    label: `${TEXTS}.section.limits`,
    description: `${TEXTS}.section.limits_description`,
    icon: "i-ph-gauge",
    fields: LIMIT_FIELDS,
  },
  {
    id: "visibility",
    label: `${TEXTS}.section.visibility`,
    description: `${TEXTS}.section.visibility_description`,
    icon: "i-ph-eye",
    fields: VISIBILITY_FIELDS,
  },
];

/**
 * The live card and the Stripe state beside the editor: it reads the form's
 * values as they are typed (its `FIELD_CHANGE` events), the saved plan until
 * the first one.
 */
const preview = CustomComponent("DmsSaasPlanEditorPreview")
  .options({ formKey: FORM_KEY })
  .meta({
    name: `${PERMISSIONS}.editor_preview`,
    description: `${PERMISSIONS}.editor_preview_description`,
    icon: "i-ph-eye",
  });

/** The editor's form beside its live preview, the preview dropping below. */
function editorLayout(form: ReturnType<typeof Form>) {
  return Grid({ gap: "1.5rem", minColumnWidth: "320px" }).child(
    "row",
    GridRow()
      .child(FORM_KEY, form, { colSpan: FORM_COLUMN_SPAN })
      .child("preview", preview),
  );
}

@RegisterPage()
export class SaasPlanNewController extends PageController(
  "new",
  {
    displayName: `${TEXTS}.new_title`,
    description: `${TEXTS}.new_description`,
    category: SaasPlansController,
    icon: "i-ph-plus",
    hidden: true,
  },
  DefaultLayout({ fullWidth: true }),
) {
  static editor = editorLayout(
    Form({
      sections: PLAN_SECTIONS,
      sectionNav: "jump",
      fetchUrl: `${PLANS_ENDPOINT}/{{query.duplicate}}/duplicate`,
      submitUrl: PLANS_ENDPOINT,
      submitUrlMethod: HttpMethod.post,
      submitLabel: `${TEXTS}.create`,
      successMessage: `${TEXTS}.created`,
      backTo: PLANS_PAGE_URL,
      redirectOnSuccess: `${PLANS_PAGE_URL}/{{response._id}}/edit`,
    }),
  );
}

@RegisterPage()
export class SaasPlanEditController extends PageController(
  "edit",
  {
    displayName: `${TEXTS}.edit_title`,
    description: `${TEXTS}.edit_description`,
    category: SaasPlansController,
    urlSlug: ":id/edit",
    icon: "i-ph-pencil-simple",
    hidden: true,
  },
  DefaultLayout({ fullWidth: true }),
) {
  static editor = editorLayout(
    Form({
      sections: PLAN_SECTIONS,
      sectionNav: "jump",
      labelKey: "name",
      fetchUrl: `${PLANS_ENDPOINT}/{{params.id}}`,
      submitUrl: `${PLANS_ENDPOINT}/{{params.id}}`,
      submitUrlMethod: HttpMethod.put,
      successMessage: `${TEXTS}.saved`,
      backTo: PLANS_PAGE_URL,
    }),
  );
}
