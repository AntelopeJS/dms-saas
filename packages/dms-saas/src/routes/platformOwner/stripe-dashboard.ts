import { Controller, Get, HTTPResult } from "@antelopejs/interface-api";
import { stripeDashboardUrl } from "../../stripe/client";

const HTTP_FOUND = 302;
const INVOICES_PATH = "/invoices";

/**
 * Links to the Stripe Dashboard of the configured account, in test mode when
 * the key is a test key. Only the mode is decided here, so a link a new tab
 * opens needs no session: it reveals nothing the Dashboard does not guard.
 */
export class SaasStripeDashboardController extends Controller(
  "/api/saas/stripe-dashboard",
) {
  @Get("/invoices")
  invoices(): HTTPResult {
    return HTTPResult.withHeaders(
      "",
      { Location: stripeDashboardUrl(INVOICES_PATH) },
      HTTP_FOUND,
    );
  }
}
