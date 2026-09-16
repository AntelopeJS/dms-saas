import { PageController, RegisterPage } from "@antelopejs/interface-dms/page";
import { Form, Tab } from "@antelopejs/interface-dms/base";
import { DefaultDataTypes } from "@antelopejs/interface-dms/base/data-types/default-types";
import { HttpMethod } from "@antelopejs/interface-dms/base/types/http";
import { SAAS_MODULE_ID } from "../module";
import { configurationCategory } from "./categories";

const BILLING_FETCH_URL = "/api/saas/settings/billing";
const LEGAL_FETCH_URL = "/api/saas/legal-documents";

const REFUND_MODE_OPTIONS = [
  { label: "$saas.settings.refund.mode.full", value: "full" },
  { label: "$saas.settings.refund.mode.prorated", value: "prorated" },
];

const billingForm = Form({
  fields: [
    {
      id: "autoSuspendEnabled",
      label: "$saas.settings.billing.auto_suspend_enabled",
      description: "$saas.settings.billing.auto_suspend_enabled_desc",
      type: new DefaultDataTypes.BooleanType(),
    },
    {
      id: "autoSuspendDelayDays",
      label: "$saas.settings.billing.auto_suspend_delay_days",
      description: "$saas.settings.billing.auto_suspend_delay_days_desc",
      type: new DefaultDataTypes.NumberType({ min: 0 }),
    },
    {
      id: "dataRetentionDaysAfterCancellation",
      label: "$saas.settings.billing.data_retention_days",
      description: "$saas.settings.billing.data_retention_days_desc",
      type: new DefaultDataTypes.NumberType({ min: 0 }),
    },
    {
      id: "maxFreeWorkspacesPerCard",
      label: "$saas.settings.billing.max_free_workspaces_per_card",
      description: "$saas.settings.billing.max_free_workspaces_per_card_desc",
      type: new DefaultDataTypes.NumberType({ min: 0 }),
    },
    {
      id: "stripeTaxCode",
      label: "$saas.settings.billing.stripe_tax_code",
      description: "$saas.settings.billing.stripe_tax_code_desc",
      type: new DefaultDataTypes.StringType(),
    },
  ],
  fetchUrl: BILLING_FETCH_URL,
  submitUrl: BILLING_FETCH_URL,
  submitUrlMethod: HttpMethod.put,
});

const refundForm = Form({
  fields: [
    {
      id: "moneyBackGuaranteeEnabled",
      label: "$saas.settings.refund.money_back_guarantee",
      description: "$saas.settings.refund.money_back_guarantee_desc",
      type: new DefaultDataTypes.BooleanType(),
    },
    {
      id: "moneyBackGuaranteeWindowDays",
      label: "$saas.settings.refund.money_back_window_days",
      description: "$saas.settings.refund.money_back_window_days_desc",
      type: new DefaultDataTypes.NumberType({ min: 0 }),
    },
    {
      id: "moneyBackGuaranteeMode",
      label: "$saas.settings.refund.money_back_mode",
      description: "$saas.settings.refund.money_back_mode_desc",
      type: new DefaultDataTypes.SelectType({ items: REFUND_MODE_OPTIONS }),
    },
    {
      id: "autoProrataOnCancelEnabled",
      label: "$saas.settings.refund.auto_prorata_on_cancel",
      description: "$saas.settings.refund.auto_prorata_on_cancel_desc",
      type: new DefaultDataTypes.BooleanType(),
    },
  ],
  fetchUrl: BILLING_FETCH_URL,
  submitUrl: BILLING_FETCH_URL,
  submitUrlMethod: HttpMethod.put,
});

const settingsTabs = Tab({
  items: [
    {
      label: "$saas.settings.tabs.billing",
      icon: "i-ph-currency-circle-dollar",
      slot: "billing",
    },
    {
      label: "$saas.settings.tabs.refund",
      icon: "i-ph-arrow-u-down-left",
      slot: "refund",
    },
    { label: "$saas.settings.tabs.legal", icon: "i-ph-scroll", slot: "legal" },
  ],
});

const legalForm = Form({
  fields: [
    {
      id: "termsOfUse",
      label: "$saas.legal.terms_of_use",
      description: "$saas.settings.legal.terms_of_use_desc",
      type: new DefaultDataTypes.RichTextType(),
    },
    {
      id: "termsAndConditions",
      label: "$saas.legal.terms_and_conditions",
      description: "$saas.settings.legal.terms_and_conditions_desc",
      type: new DefaultDataTypes.RichTextType(),
    },
    {
      id: "privacyPolicy",
      label: "$saas.legal.privacy_policy",
      description: "$saas.settings.legal.privacy_policy_desc",
      type: new DefaultDataTypes.RichTextType(),
    },
  ],
  fetchUrl: LEGAL_FETCH_URL,
  submitUrl: LEGAL_FETCH_URL,
  submitUrlMethod: HttpMethod.put,
});

@RegisterPage()
export class SaasSettingsController extends PageController("settings", {
  displayName: "$saas.settings.title",
  module: SAAS_MODULE_ID,
  category: configurationCategory,
  icon: "i-ph-gear",
  description: "$saas.settings.description",
  order: 0,
}) {
  static layout = settingsTabs
    .child("billing", billingForm, { slot: "billing" })
    .child("refund", refundForm, { slot: "refund" })
    .child("legal", legalForm, { slot: "legal" });
}
