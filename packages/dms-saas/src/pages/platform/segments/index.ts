import { PageController, RegisterPage } from "@antelopejs/interface-dms/page";
import { TableView } from "@antelopejs/interface-dms/base";
import { DefaultLayout } from "@antelopejs/interface-dms/base/layouts";
import { segmentsDataAPI } from "../../../data-api";
import { SAAS_MODULE_ID } from "../../module";
import { customersCategory } from "../categories";

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
    rowActions: {
      add: { isEnabled: true, isVisible: true },
      copyLink: true,
      delete: { isEnabled: true, isVisible: true },
      details: { isEnabled: true, isVisible: true },
      duplicate: false,
      edit: { isEnabled: true, isVisible: true },
      hasSelection: true,
      custom: [
        {
          label: "$saas.segments.actions.export_owners",
          icon: "i-ph-download-simple",
          target: {
            type: "exportJob",
            url: "/api/saas/segments/{_id}/owners-export/start",
            method: "POST",
            labels: {
              title: "$saas.segments.export.title",
              exporting: "$saas.segments.export.preparing",
              successTitle: "$saas.segments.export.success_title",
              successMessage: "$saas.segments.export.done_message",
              errorTitle: "$saas.segments.export.error_title",
            },
          },
        },
      ],
    },
  });
}
