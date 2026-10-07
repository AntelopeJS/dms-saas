import { GetMetadata } from "@antelopejs/interface-core";
import {
  PageController,
  PageMetadata,
  RegisterPage,
} from "@antelopejs/interface-dms/page";
import { KeyValueList } from "@antelopejs/interface-dms/base";
import { CustomComponent } from "@antelopejs/interface-dms/base/custom";
import { workspaceSettingsCategory } from "../module";

const KEYS = "$saas.workspace.data_export";
const INCLUDED = `${KEYS}.included`;
const PERMISSIONS = "$saas.permissions.workspace";

/** One row per part of the archive, as `buildTenantExportArchive` writes it. */
const INCLUDED_PARTS = ["modules", "billing", "manifest"] as const;

/**
 * The workspace owner's Data export page: request an archive of the
 * workspace, follow it while it builds, and download it from the history.
 */
@RegisterPage()
export class SaasTenantDataExportController extends PageController(
  "data-export",
  {
    displayName: `${KEYS}.title`,
    description: `${KEYS}.description`,
    category: workspaceSettingsCategory,
    icon: "i-ph-download-simple",
    order: 100,
  },
) {
  static request = CustomComponent("DmsSaasDataExport").meta({
    name: `${PERMISSIONS}.data_export_request`,
    description: `${PERMISSIONS}.data_export_request_description`,
    icon: "i-ph-download-simple",
  });

  static included = KeyValueList({
    title: `${INCLUDED}.title`,
    dense: true,
    items: INCLUDED_PARTS.map((part) => ({
      id: part,
      label: `${INCLUDED}.${part}`,
      value: `${INCLUDED}.${part}_format`,
    })),
  });

  static history = CustomComponent("DmsSaasDataExportHistory").meta({
    name: `${PERMISSIONS}.data_export_history`,
    description: `${PERMISSIONS}.data_export_history_description`,
    icon: "i-ph-clock-counter-clockwise",
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
