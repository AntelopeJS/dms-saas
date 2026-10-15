import {
  PageController,
  RegisterPage,
  workspaceSettingsCategory,
} from "@antelopejs/interface-dms/page";
import {
  BlockFunctions,
  Form,
  FormEvents,
  type FormFieldOrGroupSerialized,
  type FormPropsSerialized,
  Section,
  StatGroup,
} from "@antelopejs/interface-dms/base";
import { CustomComponent } from "@antelopejs/interface-dms/base/custom";
import { DefaultDataTypes } from "@antelopejs/interface-dms/base/data-types/default-types";
import { HttpMethod } from "@antelopejs/interface-dms/base/types/http";
import { WORKSPACE_NAME_MAX_LENGTH } from "../../workspaces/workspace-name";
import { isWorkspaceOwnerRequest } from "../../workspaces/workspace-owner";

/** Read and renamed here; a rename reads the whole page again (see below). */
const CURRENT_WORKSPACE_ENDPOINT = "/api/saas/workspaces/current";
const GLANCE_ENDPOINT = `${CURRENT_WORKSPACE_ENDPOINT}/glance`;
const GLANCE_ITEMS = 3;

const KEYS = "$saas.workspace.general";
const PERMISSIONS = "$saas.permissions.workspace";

const OWNER_ONLY_BADGE = {
  label: `${KEYS}.owner_only`,
  tone: "neutral",
} as const;

/** Every field shown, not edited, with the pill telling only owners rename. */
function readonlyFields(
  fields: FormFieldOrGroupSerialized[],
): FormFieldOrGroupSerialized[] {
  return fields.map((field) => ({
    ...field,
    readonly: { badge: OWNER_ONLY_BADGE },
  }));
}

/**
 * A member reads the identity but cannot rename the workspace: the form is
 * served read-only, with nothing to save, rather than failing on save.
 */
function readonlyForNonOwners(
  options: FormPropsSerialized,
  isOwner: boolean,
): FormPropsSerialized {
  if (isOwner) return options;
  return {
    ...options,
    fields: readonlyFields(options.fields),
    saveMode: "none",
  };
}

const identityForm = Form({
  fields: [
    {
      id: "name",
      label: `${KEYS}.name`,
      description: `${KEYS}.name_hint`,
      required: true,
      type: new DefaultDataTypes.StringType({
        maxLength: WORKSPACE_NAME_MAX_LENGTH,
        showCount: true,
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
})
  // The name shows elsewhere on the page: in the "At a glance" cards, the
  // danger zone's typed confirmation and the sidebar switcher. A rename reads
  // the page's blocks and data again, as any form changing what its page shows.
  .watch(FormEvents.SUBMIT_SUCCESS, BlockFunctions.REFRESH_PAGE)
  .meta({
    name: `${PERMISSIONS}.identity`,
    description: `${PERMISSIONS}.identity_description`,
    icon: "i-ph-buildings",
  })
  .onFilter(async (_permissions, options, _permissionId, context) =>
    readonlyForNonOwners(options, await isWorkspaceOwnerRequest(context)),
  );

/**
 * The workspace's General page: its identity, a glance at who is in it and
 * what it pays, and, for its owners alone, how to leave it for good.
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
  // form must not imply the right to delete the workspace. It is withheld from
  // every non-owner whatever their role grants: see `OWNER_ONLY_SURFACES`.
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
