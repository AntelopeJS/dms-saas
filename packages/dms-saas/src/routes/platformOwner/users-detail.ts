import { Controller, Get, Parameter } from "@antelopejs/interface-api";
import { AuthOwnerOnly } from "@antelopejs/interface-dms/auth";
import type { User } from "@antelopejs/interface-dms/auth/db";
import type {
  KeyValueListItem,
  StatGroupItem,
} from "@antelopejs/interface-dms/base";
import { GetModel } from "@antelopejs/interface-database-decorators";
import { getReportingCurrency } from "../../config";
import { InvoiceModel } from "../../db";
import {
  loadUserDetail,
  loadUserSegmentMatches,
  type UserDetail,
  type UserSegmentMatch,
  type UserTabCounts,
  type UserWorkspace,
  userFactItems,
  userSecurityItems,
  userTabCounts,
} from "../../users";

/** What a list block (`StatGroup`, `KeyValueList`, …) reads from its route. */
interface ItemsPayload<T> {
  items: T[];
}

/** The segments a user belongs to, for the user page's Segments tab. */
export interface UserSegmentMatches {
  items: UserSegmentMatch[];
}

/** Invoices and credit notes of the workspaces the user owns. */
async function countBilledDocuments(
  workspaces: readonly UserWorkspace[],
): Promise<number> {
  const counts = await Promise.all(
    workspaces
      .filter((workspace) => workspace.isTenantOwner)
      .map(
        async (workspace) =>
          (await GetModel(InvoiceModel, workspace.tenantId).getAll()).length,
      ),
  );
  return counts.reduce((total, count) => total + count, 0);
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

  /** The counts on the user page's tabs. */
  @Get("/:id/tab-counts")
  async getTabCounts(
    @AuthOwnerOnly() actor: User,
    @Parameter("id") id: string,
  ): Promise<UserTabCounts> {
    const detail = await loadUserDetail(id, actor._id);
    return userTabCounts(detail, await countBilledDocuments(detail.workspaces));
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
