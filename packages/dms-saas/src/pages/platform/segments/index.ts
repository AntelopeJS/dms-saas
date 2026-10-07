import { PageController, RegisterPage } from "@antelopejs/interface-dms/page";
import { TableView } from "@antelopejs/interface-dms/base";
import { DefaultLayout } from "@antelopejs/interface-dms/base/layouts";
import { segmentsDataAPI } from "../../../data-api";
import { SAAS_MODULE_ID } from "../../module";
import { customersCategory } from "../categories";

const SEGMENTS_API = "/api/saas/segments/{_id}";
/** Where the segment pages live, for links built before the page registers. */
export const SEGMENTS_PAGE_URL = "/modules/saas/customers/segments";

@RegisterPage()
export class SaasSegmentsController extends PageController(
  "segments",
  {
    displayName: "$saas.segments.title",
    module: SAAS_MODULE_ID,
    category: customersCategory,
    icon: "i-ph-funnel",
    description: "$saas.segments.description",
    order: 20,
  },
  DefaultLayout({ fullWidth: true }),
) {
  static table = TableView(segmentsDataAPI, {
    caption: "$saas.segments.caption",
    labelKey: "name",
    defaultSort: { field: "name" },
    footer: {
      countLabel: "$saas.segments.footer_count",
      hint: "$saas.segments.footer_hint",
    },
    emptyStates: {
      firstRun: {
        title: "$saas.segments.empty.title",
        description: "$saas.segments.empty.description",
        icon: "i-ph-funnel",
      },
    },
    rowActions: {
      add: {
        isEnabled: true,
        placement: "header",
        label: "$saas.segments.actions.new",
      },
      copyLink: false,
      details: false,
      duplicate: false,
      edit: {
        isEnabled: true,
        isVisible: false,
        label: "$saas.segments.actions.edit",
      },
      delete: {
        isEnabled: true,
        successMessage: "$saas.segments.deleted",
        confirm: {
          title: "$saas.segments.delete_confirm.title",
          description: "$saas.segments.delete_confirm.description",
          icon: "i-ph-trash",
          color: "error",
          confirmLabel: "$saas.segments.delete_confirm.confirm",
        },
      },
      hasSelection: true,
      custom: [
        {
          label: "$saas.segments.actions.export_users",
          icon: "i-ph-file-csv",
          target: {
            type: "exportJob",
            url: `${SEGMENTS_API}/owners-export/start`,
            method: "POST",
            labels: {
              title: "$saas.segments.export.title",
              exporting: "$saas.segments.export.preparing",
              successTitle: "$saas.segments.export.success_title",
              successMessage: "$saas.segments.export.done_message",
              errorTitle: "$saas.segments.export.error_title",
              retry: "$saas.segments.export.retry",
            },
          },
        },
        {
          label: "$saas.segments.actions.evaluate",
          icon: "i-ph-arrows-clockwise",
          target: {
            type: "api",
            url: `${SEGMENTS_API}/evaluate`,
            method: "POST",
            successMessage: "$saas.segments.evaluated",
          },
        },
        {
          label: "$saas.segments.actions.duplicate",
          icon: "i-ph-copy",
          target: {
            type: "api",
            url: `${SEGMENTS_API}/duplicate`,
            method: "POST",
            successMessage: "$saas.segments.duplicated",
          },
        },
      ],
    },
    formContainer: {
      type: "page",
      pages: {
        new: { urlSlug: "new", customPage: true },
        edit: { urlSlug: ":id/edit", customPage: true },
      },
    },
  });
}
