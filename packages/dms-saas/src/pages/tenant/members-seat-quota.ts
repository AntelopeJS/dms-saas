// A page extension is a class carrying only static component fields — that is the shape the decorator consumes.

import { RegisterPageExtension } from "@antelopejs/interface-dms/page";
import { CustomComponent } from "@antelopejs/interface-dms/base/custom";
import { MembersSettingsController } from "@antelopejs/dms/pages";

/**
 * Seats are a plan quota, so the DMS members page cannot own this block: the
 * banner is injected from here, under the members table, and stays inert on a
 * deployment that runs the DMS without the SaaS module.
 */
@RegisterPageExtension(MembersSettingsController)
export class MembersSeatQuotaExtension {
  static seatQuota = CustomComponent("DmsSaasSeatQuotaBanner")
    .meta({
      name: "$saas.workspace.seats.title",
      icon: "i-ph-users-three",
    })
    .after(MembersSettingsController.table);
}
