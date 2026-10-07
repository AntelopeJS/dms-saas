import { PageController, RegisterPage } from "@antelopejs/interface-dms/page";
import { TableView } from "@antelopejs/interface-dms/base";
import { DefaultLayout } from "@antelopejs/interface-dms/base/layouts";
import { featuresDataAPI } from "../../data-api";
import { FEATURE_VALUE_TYPES } from "../../db";
import {
  assertFeaturesUnused,
  assertValueTypeKept,
} from "../../plans/feature-guards";
import { SAAS_MODULE_ID } from "../module";
import { catalogCategory } from "./categories";

const TEXTS = "$saas.catalog.features";
const PLAN_DIALOGS_ENDPOINT = "/api/saas/plan-dialogs";
const PLANS_PAGE_URL = "/modules/saas/catalog/plans";
const FEATURES_ORDER = 10;
const PAGE_SIZE = 50;

const VALUE_TYPE_ICONS: Record<string, string> = {
  boolean: "i-ph-toggle-right",
  number: "i-ph-hash",
  string: "i-ph-text-aa",
};

const VALUE_TYPE_TABS = FEATURE_VALUE_TYPES.map((valueType) => ({
  id: valueType,
  label: `${TEXTS}.tabs.${valueType}`,
  icon: VALUE_TYPE_ICONS[valueType],
  filter: { accessorKey: "valueType", value: valueType, mode: "is" },
}));

@RegisterPage()
export class SaasFeaturesController extends PageController(
  "features",
  {
    displayName: `${TEXTS}.title`,
    module: SAAS_MODULE_ID,
    category: catalogCategory,
    icon: "i-ph-toggle-right",
    description: `${TEXTS}.description`,
    order: FEATURES_ORDER,
  },
  DefaultLayout({
    fullWidth: true,
    headerActions: [
      {
        label: `${TEXTS}.plans_button`,
        icon: "i-ph-stack",
        color: "neutral",
        target: { type: "page", url: PLANS_PAGE_URL },
      },
    ],
  }),
) {
  static table = TableView(featuresDataAPI, {
    caption: `${TEXTS}.caption`,
    labelKey: "displayName",
    searchPlaceholder: `${TEXTS}.search`,
    pageSize: PAGE_SIZE,
    defaultSort: { field: "order" },
    reorder: { field: "order" },
    tabs: [
      { id: "all", label: `${TEXTS}.tabs.all`, icon: "i-ph-list" },
      ...VALUE_TYPE_TABS,
      {
        id: "detail",
        label: `${TEXTS}.tabs.detail`,
        icon: "i-ph-eye-slash",
        filter: { accessorKey: "isDetailRow", value: "true", mode: "is" },
      },
    ],
    rowActions: {
      add: { isEnabled: true, label: `${TEXTS}.create`, placement: "header" },
      edit: true,
      details: false,
      duplicate: true,
      copyLink: true,
      hasSelection: false,
      delete: {
        isEnabled: true,
        confirm: { from: `${PLAN_DIALOGS_ENDPOINT}/features/{_id}/delete` },
        successMessage: `${TEXTS}.deleted`,
      },
    },
    formContainer: {
      type: "drawer",
      pages: {
        new: {
          displayName: `${TEXTS}.form.new_title`,
          description: `${TEXTS}.form.new_description`,
        },
        edit: {
          displayName: `${TEXTS}.form.edit_title`,
          description: `${TEXTS}.form.edit_description`,
        },
      },
    },
    footer: { countLabel: `${TEXTS}.count`, hint: `${TEXTS}.footer_hint` },
    emptyStates: {
      firstRun: {
        title: `${TEXTS}.empty.title`,
        description: `${TEXTS}.empty.description`,
        icon: "i-ph-toggle-right",
      },
    },
    guards: {
      edit: (_ctx, { id, body, current }) =>
        assertValueTypeKept(id, body, current),
      delete: (_ctx, { ids }) => assertFeaturesUnused(ids),
    },
  });
}
