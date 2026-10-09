// A page extension is a class carrying only static component fields — that is the shape the decorator consumes.

import { RegisterPageExtension } from "@antelopejs/interface-dms/page";
import { CustomComponent } from "@antelopejs/interface-dms/base/custom";

/** The component key both DMS member pages declare their table under. */
const TABLE_ANCHOR = "table";

// One builder per page: a component builder holds the position of the page it
// is injected into.
function seatQuotaBlock() {
  return CustomComponent("DmsSaasSeatQuotaBanner")
    .meta({
      name: "$saas.permissions.workspace.seats",
      description: "$saas.permissions.workspace.seats_description",
      icon: "i-ph-users-three",
    })
    .after(TABLE_ANCHOR);
}

/**
 * Seats are a plan quota, so the DMS members page cannot own this block: the
 * seat meter, the platform support list and the "seats full" notice are
 * injected from here, under the members table, and stay inert on a
 * deployment that runs the DMS without the SaaS module. The invite button
 * itself stays the DMS's: `RegisterInviteAvailability` disables it at the
 * limit, with the reason.
 *
 * The target page is named by its id and the anchor by the component key the
 * page declares it under, so nothing is imported from the DMS runtime.
 */
@RegisterPageExtension("settings.workspace.members")
export class MembersSeatQuotaExtension {
  static seatQuota = seatQuotaBlock();
}

/**
 * The same block on the invitations page, a page of its own next to Members
 * since DMS 0.7: invitations take seats too, so the quota shows where they
 * are sent and revoked.
 */
@RegisterPageExtension("settings.workspace.invites")
export class InvitesSeatQuotaExtension {
  static seatQuota = seatQuotaBlock();
}
