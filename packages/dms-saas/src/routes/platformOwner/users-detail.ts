import { Controller, Get, Parameter } from "@antelopejs/interface-api";
import { assert } from "@antelopejs/interface-api-util";
import { CROSS_INSTANCE } from "@antelopejs/interface-database";
import { GetModel, Model } from "@antelopejs/interface-database-decorators";
import { TenantMemberModel, TenantModel } from "@antelopejs/interface-dms/db";
import { AuthOwnerOnly } from "@antelopejs/interface-dms/auth";
import {
  SessionModel,
  type User,
  UserModel,
} from "@antelopejs/interface-dms/auth/db";
import { SegmentModel, UserSegmentModel } from "../../db";

const HTTP_NOT_FOUND = 404;

export class SaasUsersDetailController extends Controller("/api/saas/users") {
  @Get("/:id")
  async getDetail(
    @AuthOwnerOnly() _user: User,
    @Parameter("id") id: string,
    @Model(UserModel) userModel: UserModel,
    @Model(TenantModel) tenantModel: TenantModel,
    @Model(SessionModel) sessionModel: SessionModel,
  ) {
    const user = await userModel.get(id);
    assert(user, HTTP_NOT_FOUND, "saas.errors.user.not_found");
    const memberModel = GetModel(TenantMemberModel, CROSS_INSTANCE);
    const [memberships, sessions, segmentLinks] = await Promise.all([
      memberModel.listByUserWithTenantIds(id),
      sessionModel.getByUserId(id),
      GetModel(UserSegmentModel).listByUser(id),
    ]);
    const tenants = await tenantModel.getMany(
      memberships.map((m) => m.tenantId),
    );
    const tenantNamesById = new Map(tenants.map((t) => [t._id, t.name]));
    const workspaces = memberships.map((m) => ({
      _id: m.tenantId,
      name: tenantNamesById.get(m.tenantId) ?? m.tenantId,
      isTenantOwner: m.member.isTenantOwner,
    }));

    let lastActiveAt: Date | null = null;
    for (const session of sessions) {
      if (!session.lastActiveAt) continue;
      const active = new Date(session.lastActiveAt);
      if (!lastActiveAt || active > lastActiveAt) lastActiveAt = active;
    }

    const segments =
      segmentLinks.length > 0
        ? (
            await GetModel(SegmentModel).getMany(
              segmentLinks.map((l) => l.segmentId),
            )
          ).map((s) => ({ _id: s._id, name: s.name }))
        : [];

    return {
      _id: user._id,
      email: user.email,
      name: user.name,
      owner: user.owner,
      createdAt: user.createdAt,
      language: user.language ?? null,
      isValidated: !!user.isValidated,
      hasTwoFactor: (user.twoFactorMethods ?? []).length > 0,
      lastActiveAt,
      segments,
      workspaces,
    };
  }
}
