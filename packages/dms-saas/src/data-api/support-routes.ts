import type { RequestContext } from "@antelopejs/interface-api";
import { assert } from "@antelopejs/interface-api-util";
import type { DataControllerCallback } from "@antelopejs/interface-data-api";
import type { Parameters } from "@antelopejs/interface-data-api/components";
import { GetModel } from "@antelopejs/interface-database-decorators";
import { AuthTenantMember } from "@antelopejs/interface-dms/guards";
import { getRequestTenantId } from "@antelopejs/interface-dms/request-tenant";
import { AuthOwnerOnly } from "@antelopejs/interface-dms/auth";
import { TableViewRoutes } from "@antelopejs/interface-dms/base";
import {
  SUPPORT_EVENT_ORDER_INDEX,
  SUPPORT_MESSAGE_ORDER_INDEX,
  SUPPORT_TICKET_ORDER_INDEX,
  SupportTicketModel,
} from "../db";
import { reconcileSupportTicket } from "../support/publications";

type SupportAudience = "tenant" | "platform";
type SupportCollection = "tickets" | "messages" | "events" | "owners";
const HTTP_BAD_REQUEST = 400;
const PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;
const GUARDS = { tenant: AuthTenantMember, platform: AuthOwnerOnly };
const RECENT_SORTS = {
  tickets: ["lastMessageAt", SUPPORT_TICKET_ORDER_INDEX],
  messages: ["createdAt", SUPPORT_MESSAGE_ORDER_INDEX],
  events: ["createdAt", SUPPORT_EVENT_ORDER_INDEX],
  owners: ["_id", "_id"],
};

function validatePagination(params: Parameters.ListParameters): void {
  assert(
    Number.isSafeInteger(params.offset ?? 0) &&
      (params.offset ?? 0) >= 0 &&
      Number.isSafeInteger(params.limit ?? PAGE_SIZE) &&
      (params.limit ?? PAGE_SIZE) > 0 &&
      (!params.sortDirection || ["asc", "desc"].includes(params.sortDirection)),
    HTTP_BAD_REQUEST,
    "saas.errors.support.invalid_pagination",
  );
}

/** Resolves an owner-selected tenant or the authenticated member's tenant. */
export function supportTenantId(ctx: RequestContext): string {
  return ctx.routeParameters.tenantId ?? getRequestTenantId(ctx);
}

async function scopedParameters(
  ctx: RequestContext,
  params: Parameters.ListParameters,
  collection: SupportCollection,
): Promise<Parameters.ListParameters> {
  validatePagination(params);
  const filters = { ...params.filters };
  if (collection === "messages" || collection === "events") {
    const ticketId = ctx.routeParameters.ticketId;
    await reconcileSupportTicket(
      GetModel(SupportTicketModel, supportTenantId(ctx)),
      ticketId,
    );
    filters.ticketId = [ticketId, "eq"];
  }
  if (collection === "owners") filters.owner = ["true", "eq"];
  const [dateField, recentIndex] = RECENT_SORTS[collection];
  const sortKey = params.sortKey ?? dateField;
  return {
    ...params,
    filters,
    limit: Math.min(params.limit ?? PAGE_SIZE, MAX_PAGE_SIZE),
    // Compound indexes retain the ID tie-breaker for equal timestamps.
    sortKey: sortKey === dateField ? recentIndex : sortKey,
    sortDirection: params.sortDirection ?? "desc",
    noPluck: false,
    noForeign: false,
  };
}

function scopedRoute(
  base: DataControllerCallback,
  audience: SupportAudience,
  collection: SupportCollection,
): DataControllerCallback {
  return {
    ...base,
    args: [...base.args.slice(0, -1), GUARDS[audience]()],
    func: async function (
      this: unknown,
      ctx: RequestContext,
      params: Parameters.ListParameters,
      ...rest: unknown[]
    ) {
      const scoped = await scopedParameters(ctx, params, collection);
      return base.func.call(this, ctx, scoped, ...rest);
    },
  };
}

/** Exposes only guarded list/count reads, with immutable thread/owner scope. */
export function supportReadRoutes(
  audience: SupportAudience,
  collection: SupportCollection,
) {
  return {
    list: scopedRoute(TableViewRoutes.List, audience, collection),
    count: scopedRoute(TableViewRoutes.Count, audience, collection),
  };
}
