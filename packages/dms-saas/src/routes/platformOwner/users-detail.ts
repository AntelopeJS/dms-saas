import { Controller, Get, Parameter } from "@antelopejs/interface-api";
import { AuthOwnerOnly } from "@antelopejs/interface-dms/auth";
import type { User } from "@antelopejs/interface-dms/auth/db";
import type {
  KeyValueListItem,
  StatGroupItem,
} from "@antelopejs/interface-dms/base";
import { getReportingCurrency } from "../../config";
import {
  loadUserDetail,
  loadUserSegmentMatches,
  type UserDetail,
  type UserSegmentMatch,
  userFactItems,
  userSecurityItems,
} from "../../users";

/** What a list block (`StatGroup`, `KeyValueList`, …) reads from its route. */
interface ItemsPayload<T> {
  items: T[];
}

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

  /** The figures under the user's header. */
  @Get("/:id/facts")
  async getFacts(
    @AuthOwnerOnly() actor: User,
    @Parameter("id") id: string,
  ): Promise<ItemsPayload<StatGroupItem>> {
    const detail = await loadUserDetail(id, actor._id);
    return { items: userFactItems(detail, getReportingCurrency()) };
  }

  /** How the user signs in, for the security card. */
  @Get("/:id/security")
  async getSecurity(
    @AuthOwnerOnly() actor: User,
    @Parameter("id") id: string,
  ): Promise<ItemsPayload<KeyValueListItem>> {
    const detail = await loadUserDetail(id, actor._id);
    return { items: userSecurityItems(detail.security) };
  }

  @Get("/:id/segments")
  async getSegments(
    @AuthOwnerOnly() _actor: User,
    @Parameter("id") id: string,
  ): Promise<UserSegmentMatches> {
    return { items: await loadUserSegmentMatches(id) };
  }
}
