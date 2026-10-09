import { PageController, RegisterPage } from "@antelopejs/interface-dms/page";
import { Form, Section, StatGroup } from "@antelopejs/interface-dms/base";
import { CustomComponent } from "@antelopejs/interface-dms/base/custom";
import { DefaultDataTypes } from "@antelopejs/interface-dms/base/data-types/default-types";
import { HttpMethod } from "@antelopejs/interface-dms/base/types/http";
import { WORKSPACE_NAME_MAX_LENGTH } from "../../workspaces/workspace-name";
import { workspaceSettingsCategory } from "../module";

/** Read and renamed here; the switcher refreshes when this form saves. */
const CURRENT_WORKSPACE_ENDPOINT = "/api/saas/workspaces/current";
const GLANCE_ENDPOINT = `${CURRENT_WORKSPACE_ENDPOINT}/glance`;
const GLANCE_ITEMS = 3;

const KEYS = "$saas.workspace.general";
const PERMISSIONS = "$saas.permissions.workspace";

const identityForm = Form({
  fields: [
    {
      id: "name",
      label: `${KEYS}.name`,
      description: `${KEYS}.name_hint`,
      required: true,
      type: new DefaultDataTypes.StringType({
        maxLength: WORKSPACE_NAME_MAX_LENGTH,
      }),
    },
    {
      id: "_id",
      label: `${KEYS}.workspace_id`,
      description: `${KEYS}.workspace_id_hint`,
      readonly: true,
      type: new DefaultDataTypes.StringType({ copyable: true }),
    },
  ],
  fetchUrl: CURRENT_WORKSPACE_ENDPOINT,
  submitUrl: CURRENT_WORKSPACE_ENDPOINT,
  submitUrlMethod: HttpMethod.put,
  saveMode: "bar",
  successMessage: `${KEYS}.renamed`,
  errorMessage: `${KEYS}.error.rename`,
}).meta({
  name: `${PERMISSIONS}.identity`,
  description: `${PERMISSIONS}.identity_description`,
  icon: "i-ph-buildings",
});

/**
 * The workspace owner's General page: the workspace's identity, a glance at
 * who is in it and what it pays, and how to leave it for good.
 */
@RegisterPage()
export class SaasTenantGeneralController extends PageController("general", {
  displayName: `${KEYS}.title`,
  description: `${KEYS}.description`,
  category: workspaceSettingsCategory,
  icon: "i-ph-sliders-horizontal",
  order: 0,
}) {
  static identity = Section({
    title: `${KEYS}.identity_title`,
    description: `${KEYS}.identity_intro`,
  }).child("form", identityForm);

  static glance = Section({
    title: `${KEYS}.glance.title`,
    description: `${KEYS}.glance.description`,
    card: false,
  }).child(
    "facts",
    StatGroup({
      fetchUrl: GLANCE_ENDPOINT,
      layout: "cards",
      columns: GLANCE_ITEMS,
      skeletonCount: GLANCE_ITEMS,
      label: `${KEYS}.glance.title`,
    }).meta({
      name: `${PERMISSIONS}.glance`,
      description: `${PERMISSIONS}.glance_description`,
      icon: "i-ph-binoculars",
    }),
  );

  // Separate component, hence a separate permission node: granting the rename
  // form must not imply the right to delete the workspace.
  static dangerZone = Section({
    title: `${KEYS}.danger_zone_title`,
    danger: true,
  }).child(
    "actions",
    CustomComponent("DmsSaasWorkspaceDangerZone").meta({
      name: `${PERMISSIONS}.danger_zone`,
      description: `${PERMISSIONS}.danger_zone_description`,
      icon: "i-ph-warning-octagon",
    }),
  );
}
