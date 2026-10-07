import { Controller, Get, Parameter } from "@antelopejs/interface-api";
import { AuthOwnerOnly } from "@antelopejs/interface-dms/auth";
import type { User } from "@antelopejs/interface-dms/auth/db";
import {
  loadUserDetail,
  loadUserSegmentMatches,
  type UserDetail,
  type UserSegmentMatch,
} from "../../users";

/** The segments a user belongs to, for the user page's Segments tab. */
export interface UserSegmentMatches {
  items: UserSegmentMatch[];
}

export class SaasUsersDetailController extends Controller("/api/saas/users") {
  @Get("/:id")
  getDetail(
    @AuthOwnerOnly() actor: User,
    @Parameter("id") id: string,
  ): Promise<UserDetail> {
    return loadUserDetail(id, actor._id);
  }

  @Get("/:id/segments")
  async getSegments(
    @AuthOwnerOnly() _actor: User,
    @Parameter("id") id: string,
  ): Promise<UserSegmentMatches> {
    return { items: await loadUserSegmentMatches(id) };
  }
}
