import { GetMetadata } from "@antelopejs/interface-core";
import {
  PageController,
  PageMetadata,
  RegisterPage,
} from "@antelopejs/interface-dms/page";
import { CustomComponent } from "@antelopejs/interface-dms/base/custom";
import { workspaceSettingsCategory } from "../module";

@RegisterPage()
export class SaasTenantDataExportController extends PageController(
  "data-export",
  {
    displayName: "$saas.workspace.data_export.title",
    description: "$saas.workspace.data_export.description",
    category: workspaceSettingsCategory,
    icon: "i-ph-download-simple",
    order: 100,
  },
) {
  static dataExport = CustomComponent("DmsSaasDataExport").meta({
    name: "$saas.workspace.data_export.title",
    icon: "i-ph-download-simple",
  });
}

/**
 * Client-side path of the page, read from its own registration rather than
 * spelled out again: a delivered export link lands here, and a renamed slug
 * would otherwise send the recipient to a 404.
 */
export const DATA_EXPORT_PAGE_PATH =
  GetMetadata(SaasTenantDataExportController, PageMetadata).pageInfo
    ?.fullSlug ?? "";
