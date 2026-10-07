import { PageController, RegisterPage } from "@antelopejs/interface-dms/page";
import {
  type FieldGroup,
  Form,
  type FormField,
  type FormSection,
} from "@antelopejs/interface-dms/base";
import { DefaultDataTypes } from "@antelopejs/interface-dms/base/data-types/default-types";
import { FormPageLayout } from "@antelopejs/interface-dms/base/layouts";
import { HttpMethod } from "@antelopejs/interface-dms/base/types/http";
import {
  LEGAL_DOCUMENT_KEYS,
  type LegalDocumentKey,
  REFUND_PRORATA_MODES,
} from "../../db";
import { FormInsightType } from "../../utils";
import { SAAS_MODULE_ID } from "../module";
import { configurationCategory } from "./categories";

const RULES = "$saas.operator_billing.billing_rules";
const PERMISSIONS = "$saas.permissions.billing";
const BILLING_RULES_URL = "/api/saas/settings/billing";
const MAX_DAYS = 365;
const MAX_RETENTION_DAYS = 3650;
const MAX_FREE_WORKSPACES_PER_CARD = 100;

const LEGAL_DOCUMENT_SLUGS: Record<LegalDocumentKey, string> = {
  termsOfUse: "terms_of_use",
  termsAndConditions: "terms_and_conditions",
  privacyPolicy: "privacy_policy",
};

function countField(
  id: string,
  key: string,
  min: number,
  max: number,
): FormField {
  return {
    id,
    label: `${RULES}.${key}`,
    description: `${RULES}.${key}_description`,
    hint: `${RULES}.${key}_hint`,
    type: new DefaultDataTypes.NumberType({ min, max, step: 1 }),
    required: true,
  };
}

function switchField(id: string, key: string): FormField {
  return {
    id,
    label: `${RULES}.${key}`,
    description: `${RULES}.${key}_description`,
    type: new DefaultDataTypes.BooleanType(),
  };
}

function insightField(id: string, key: string, component: string): FormField {
  return {
    id,
    label: `${RULES}.${key}`,
    type: new FormInsightType(component),
  };
}

const unpaidSection: FormSection = {
  id: "unpaid",
  label: `${RULES}.unpaid.title`,
  description: `${RULES}.unpaid.description`,
  icon: "i-ph-warning-circle",
  fields: [
    switchField("autoSuspendEnabled", "unpaid.suspend"),
    countField("autoSuspendDelayDays", "unpaid.suspend_days", 1, MAX_DAYS),
    countField(
      "dataRetentionDaysAfterCancellation",
      "unpaid.retention_days",
      0,
      MAX_RETENTION_DAYS,
    ),
    insightField(
      "customerTimeline",
      "unpaid.timeline",
      "DmsSaasDunningTimeline",
    ),
  ],
};

const freeSection: FormSection = {
  id: "free",
  label: `${RULES}.free.title`,
  description: `${RULES}.free.description`,
  icon: "i-ph-gift",
  fields: [
    countField(
      "maxFreeWorkspacesPerCard",
      "free.per_card",
      0,
      MAX_FREE_WORKSPACES_PER_CARD,
    ),
  ],
};

const taxSection: FormSection = {
  id: "tax",
  label: `${RULES}.tax.title`,
  description: `${RULES}.tax.description`,
  icon: "i-ph-percent",
  fields: [
    {
      id: "stripeTaxCode",
      label: `${RULES}.tax.code`,
      description: `${RULES}.tax.code_description`,
      hint: `${RULES}.tax.code_hint`,
      type: new DefaultDataTypes.StringType({ placeholder: "txcd_10000000" }),
      required: true,
    },
    insightField("planTaxSync", "tax.plans", "DmsSaasPlanTaxSync"),
  ],
};

const REFUND_MODE_ITEMS = REFUND_PRORATA_MODES.map((mode) => ({
  label: `${RULES}.refunds.mode.${mode}`,
  description: `${RULES}.refunds.mode.${mode}_description`,
  value: mode,
}));

const refundSection: FormSection = {
  id: "refunds",
  label: `${RULES}.refunds.title`,
  description: `${RULES}.refunds.description`,
  icon: "i-ph-arrow-u-down-left",
  fields: [
    switchField("moneyBackGuaranteeEnabled", "refunds.guarantee"),
    countField("moneyBackGuaranteeWindowDays", "refunds.window", 1, MAX_DAYS),
    {
      id: "moneyBackGuaranteeMode",
      label: `${RULES}.refunds.amount`,
      description: `${RULES}.refunds.amount_description`,
      type: new DefaultDataTypes.SelectType({
        items: REFUND_MODE_ITEMS,
        display: "cards",
      }),
      required: true,
    },
    insightField("refundExample", "refunds.example", "DmsSaasRefundExample"),
    switchField("autoProrataOnCancelEnabled", "refunds.on_cancel"),
  ],
};

function legalDocumentGroup(key: LegalDocumentKey): FieldGroup {
  const slug = LEGAL_DOCUMENT_SLUGS[key];
  return {
    id: `${key}Group`,
    label: `${RULES}.legal.${slug}`,
    orientation: "vertical",
    fields: [
      {
        id: `${key}Release`,
        type: new FormInsightType("DmsSaasLegalDocumentRelease"),
      },
      { id: key, type: new DefaultDataTypes.RichTextType() },
    ],
  };
}

const legalSection: FormSection = {
  id: "legal",
  label: `${RULES}.legal.title`,
  description: `${RULES}.legal.description`,
  icon: "i-ph-scroll",
  fields: LEGAL_DOCUMENT_KEYS.map(legalDocumentGroup),
};

/**
 * Billing rules & legal: what happens when a payment fails, free workspaces,
 * tax, refunds and the legal documents, on one page saved at once.
 */
@RegisterPage()
export class SaasSettingsController extends PageController(
  "settings",
  {
    displayName: `${RULES}.title`,
    module: SAAS_MODULE_ID,
    category: configurationCategory,
    icon: "i-ph-scales",
    description: `${RULES}.description`,
    order: 0,
  },
  FormPageLayout(),
) {
  static form = Form({
    fetchUrl: BILLING_RULES_URL,
    submitUrl: BILLING_RULES_URL,
    submitUrlMethod: HttpMethod.put,
    saveMode: "bar",
    sectionNav: "side",
    submitLabel: `${RULES}.save`,
    successMessage: `${RULES}.saved`,
    sections: [
      unpaidSection,
      freeSection,
      taxSection,
      refundSection,
      legalSection,
    ],
  }).meta({
    name: `${PERMISSIONS}.billing_rules`,
    description: `${PERMISSIONS}.billing_rules_description`,
    icon: "i-ph-scales",
  });
}
