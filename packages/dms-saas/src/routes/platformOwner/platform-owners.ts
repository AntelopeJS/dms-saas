import { Controller, Get, Parameter, Post } from "@antelopejs/interface-api";
import { assert } from "@antelopejs/interface-api-util";
import { Model } from "@antelopejs/interface-database-decorators";
import { AuthOwnerOnly } from "@antelopejs/interface-dms/auth";
import type { ConfirmDialogSerialized } from "@antelopejs/interface-dms/base";
import { type User, UserModel } from "@antelopejs/interface-dms/auth/db";
import {
  notifyAllPlatformOwners,
  platformOwnerAddedSubject,
  platformOwnerRemovedSubject,
} from "../../notifications";
import {
  demoteConfirm,
  loadPlatformRoleImpact,
  promoteConfirm,
  syncSeatsAfterPlatformRoleChange,
} from "../../users/platform-role";

const HTTP_BAD_REQUEST = 400;
const HTTP_CONFLICT = 409;
const ADDED_ICON = "i-ph-user-plus";
const REMOVED_ICON = "i-ph-user-minus";

/** What a promotion or a demotion answers. */
export interface PlatformRoleChange {
  userId: string;
}

/**
 * Platform admins (the DMS's `owner` users) promote and demote each other.
 * The platform always keeps one, and none demotes themself.
 */
export class SaasPlatformOwnersController extends Controller(
  "/api/saas/platform-owners",
) {
  @Model(UserModel)
  declare userModel: UserModel;

  @Get("/:userId/promote-confirm")
  async promoteConfirm(
    @AuthOwnerOnly() actor: User,
    @Parameter("userId", "param") userId: string,
  ): Promise<ConfirmDialogSerialized> {
    return promoteConfirm(await loadPlatformRoleImpact(userId, actor._id));
  }

  @Get("/:userId/demote-confirm")
  async demoteConfirm(
    @AuthOwnerOnly() actor: User,
    @Parameter("userId", "param") userId: string,
  ): Promise<ConfirmDialogSerialized> {
    return demoteConfirm(await loadPlatformRoleImpact(userId, actor._id));
  }

  @Post("/:userId/promote")
  async promote(
    @AuthOwnerOnly() actor: User,
    @Parameter("userId", "param") userId: string,
  ): Promise<PlatformRoleChange> {
    const impact = await loadPlatformRoleImpact(userId, actor._id);
    assert(
      !impact.user.owner,
      HTTP_CONFLICT,
      "saas.errors.platform_owner.already_owner",
    );
    await this.userModel.update(userId, { owner: true });
    await syncSeatsAfterPlatformRoleChange(userId, impact.memberWorkspaces);
    await notifyAllPlatformOwners(
      platformOwnerAddedSubject,
      {
        icon: ADDED_ICON,
        title: "Platform admin added",
        description: `${impact.user.email} is now a platform admin.`,
      },
      userId,
    );
    return { userId };
  }

  @Post("/:userId/demote")
  async demote(
    @AuthOwnerOnly() actor: User,
    @Parameter("userId", "param") userId: string,
  ): Promise<PlatformRoleChange> {
    assert(
      userId !== actor._id,
      HTTP_BAD_REQUEST,
      "saas.errors.platform_owner.cannot_demote_self",
    );
    const impact = await loadPlatformRoleImpact(userId, actor._id);
    assert(
      impact.user.owner,
      HTTP_CONFLICT,
      "saas.errors.platform_owner.not_owner",
    );
    const otherOwners = await this.userModel.countOwnersExcluding([userId]);
    assert(
      otherOwners >= 1,
      HTTP_BAD_REQUEST,
      "saas.errors.platform_owner.cannot_demote_last_owner",
    );
    await this.userModel.update(userId, { owner: false });
    await syncSeatsAfterPlatformRoleChange(userId, impact.memberWorkspaces);
    await notifyAllPlatformOwners(platformOwnerRemovedSubject, {
      icon: REMOVED_ICON,
      title: "Platform admin removed",
      description: `${impact.user.email} is no longer a platform admin.`,
    });
    return { userId };
  }
}
