import {
  Context,
  Controller,
  Get,
  type RequestContext,
} from "@antelopejs/interface-api";
import type { UpcomingInvoicePreview } from "@antelopejs/interface-dms-saas/billing";
import { AuthTenantMember } from "@antelopejs/interface-dms/guards";
import { getRequestTenantId } from "@antelopejs/interface-dms/request-tenant";
import type { User } from "@antelopejs/interface-dms/auth/db";
import { getUpcomingInvoicePreview } from "../../upcoming-invoice/preview";

/**
 * Upcoming invoice of the current workspace as Stripe prices it, tax included.
 * Always answers 200 with a typed state: `absent` for a workspace with nothing
 * to bill, `unavailable` when Stripe cannot price it right now.
 */
export class SaasTenantUpcomingInvoiceController extends Controller(
  "/api/saas/tenant/upcoming-invoice",
) {
  @Get("/")
  async getUpcomingInvoice(
    @Context() ctx: RequestContext,
    @AuthTenantMember() _user: User,
  ): Promise<UpcomingInvoicePreview> {
    return getUpcomingInvoicePreview(getRequestTenantId(ctx));
  }
}
