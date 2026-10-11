import type { ControllerClass } from "@antelopejs/interface-api";
import type { ComponentTargetInput } from "@antelopejs/interface-dms/component";
import { GetPermissionId } from "@antelopejs/interface-dms/page";
import { SaasTenantDataExportController } from "./data-export";
import { SaasTenantGeneralController } from "./general";

/**
 * The workspace surfaces only its owners reach, whatever a member's role
 * grants: deleting the workspace, and exporting all of its data. Their routes
 * accept owners alone, so serving them to a member would only show errors.
 */
const OWNER_ONLY_SURFACES: (ControllerClass | ComponentTargetInput)[] = [
  SaasTenantGeneralController.dangerZone,
  SaasTenantDataExportController,
];

/**
 * The permission ids of the owner-only surfaces. Withholding one withholds
 * everything declared under it: a page takes its blocks, its menu entry with
 * it.
 */
export function ownerOnlyPermissionIds(): string[] {
  return OWNER_ONLY_SURFACES.map((surface) => GetPermissionId(surface)).filter(
    (id): id is string => !!id,
  );
}
