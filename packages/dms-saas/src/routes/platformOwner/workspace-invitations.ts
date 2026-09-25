import { Controller, Parameter, Post } from "@antelopejs/interface-api";
import { assert } from "@antelopejs/interface-api-util";
import { Model } from "@antelopejs/interface-database-decorators";
import { TenantModel } from "@antelopejs/interface-dms/db";
import { AuthOwnerOnly } from "@antelopejs/interface-dms/auth";
import type { User } from "@antelopejs/interface-dms/auth/db";
import {
  copyInvitationLinkCommand,
  operatorActorOf,
  resendInvitationCommand,
} from "../../operator-actions";
import { inviterNameOf } from "../../workspaces/invitations";

const HTTP_NOT_FOUND = 404;
const HTTP_BAD_GATEWAY = 502;

/** Back-office handling of a workspace's pending invitations. */
export class SaasWorkspaceInvitationsController extends Controller(
  "/api/saas/workspaces",
) {
  @Model(TenantModel)
  declare tenantModel: TenantModel;

  private async assertTenantExists(tenantId: string): Promise<void> {
    const tenant = await this.tenantModel.get(tenantId);
    assert(tenant, HTTP_NOT_FOUND, "saas.errors.workspace.not_found");
  }

  /**
   * Reissues the invitation and emails it. The new token is kept even when the
   * email does not leave: the error only tells the operator to hand the link
   * over instead.
   */
  @Post("/:tenantId/invitations/:inviteId/resend")
  async resend(
    @AuthOwnerOnly() user: User,
    @Parameter("tenantId", "param") tenantId: string,
    @Parameter("inviteId", "param") inviteId: string,
  ) {
    await this.assertTenantExists(tenantId);
    const { invite, emailDelivery } = await resendInvitationCommand({
      tenantId,
      inviteId,
      actor: operatorActorOf(user),
      inviterName: inviterNameOf(user),
    });
    assert(
      emailDelivery === "sent",
      HTTP_BAD_GATEWAY,
      "saas.errors.invitations.email_not_sent",
    );
    return { emailDelivery, expiresAt: invite.expiresAt };
  }

  @Post("/:tenantId/invitations/:inviteId/link")
  async copyLink(
    @AuthOwnerOnly() user: User,
    @Parameter("tenantId", "param") tenantId: string,
    @Parameter("inviteId", "param") inviteId: string,
  ) {
    await this.assertTenantExists(tenantId);
    return copyInvitationLinkCommand({
      tenantId,
      inviteId,
      actor: operatorActorOf(user),
    });
  }
}
