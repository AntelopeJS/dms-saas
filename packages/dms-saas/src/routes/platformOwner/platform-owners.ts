import { Controller, Parameter, Post } from "@antelopejs/interface-api";
import { assert } from "@antelopejs/interface-api-util";
import { Model } from "@antelopejs/interface-database-decorators";
import { AuthOwnerOnly } from "@antelopejs/interface-dms/auth";
import { type User, UserModel } from "@antelopejs/interface-dms/auth/db";
import {
  notifyAllPlatformOwners,
  platformOwnerAddedSubject,
  platformOwnerRemovedSubject,
} from "../../notifications";

const HTTP_BAD_REQUEST = 400;
const HTTP_NOT_FOUND = 404;
const HTTP_CONFLICT = 409;
const ADDED_ICON = "i-ph-user-plus";
const REMOVED_ICON = "i-ph-user-minus";

export class SaasPlatformOwnersController extends Controller(
  "/api/saas/platform-owners",
) {
  @Model(UserModel)
  declare userModel: UserModel;

  @Post("/:userId/promote")
  async promote(
    @AuthOwnerOnly() _actor: User,
    @Parameter("userId", "param") userId: string,
  ) {
    const target = await this.userModel.get(userId);
    assert(target, HTTP_NOT_FOUND, "saas.errors.user.not_found");
    assert(
      !target.owner,
      HTTP_CONFLICT,
      "saas.errors.platform_owner.already_owner",
    );
    await this.userModel.update(userId, { owner: true });
    await notifyAllPlatformOwners(
      platformOwnerAddedSubject,
      {
        icon: ADDED_ICON,
        title: "Platform owner added",
        description: `${target.email} is now a platform owner.`,
      },
      userId,
    );
    return { userId };
  }

  @Post("/:userId/demote")
  async demote(
    @AuthOwnerOnly() actor: User,
    @Parameter("userId", "param") userId: string,
  ) {
    assert(
      userId !== actor._id,
      HTTP_BAD_REQUEST,
      "saas.errors.platform_owner.cannot_demote_self",
    );
    const target = await this.userModel.get(userId);
    assert(target, HTTP_NOT_FOUND, "saas.errors.user.not_found");
    assert(target.owner, HTTP_CONFLICT, "saas.errors.platform_owner.not_owner");
    const otherOwners = await this.userModel.countOwnersExcluding([userId]);
    assert(
      otherOwners >= 1,
      HTTP_BAD_REQUEST,
      "saas.errors.platform_owner.cannot_demote_last_owner",
    );
    await this.userModel.update(userId, { owner: false });
    await notifyAllPlatformOwners(platformOwnerRemovedSubject, {
      icon: REMOVED_ICON,
      title: "Platform owner removed",
      description: `${target.email} is no longer a platform owner.`,
    });
    return { userId };
  }
}
