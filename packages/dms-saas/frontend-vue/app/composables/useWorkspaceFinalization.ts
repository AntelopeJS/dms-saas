/**
 * Completing a self-service registration that entered without a workspace.
 *
 * The account already exists — it signed in through OAuth, or through any
 * entry point that ends on a tenant assignment token — and everything that is
 * still missing is bought here: a workspace, a plan, a card. The API answers
 * with a session for the workspace it just provisioned, so the visitor lands
 * signed in rather than back on the login screen.
 *
 * That session is opened by the frontend server, never in the browser: the
 * page asks the loader's `/auth/establish` route to call the finalize endpoint
 * on its behalf, and the loader writes its session cookie from the token pair
 * the API returns. No access or refresh token is ever handed to the page.
 *
 * The finalize endpoint is declared by the module itself, through
 * `authEstablishEndpoints` on its `AddFrontendModule` registration: the DMS
 * carries it in the frontend manifest and the loader writes it into the
 * workspace, so a standard deployment needs no configuration. Any endpoint
 * neither declared nor named in the frontend server's
 * `DMS_AUTH_ESTABLISH_ENDPOINTS` is answered 403 and never called.
 */

/** Loader route that opens a session from a backend-issued token pair. */
export const SESSION_ESTABLISH_ENDPOINT = "/auth/establish";

/** DMS API route that provisions the workspace and mints that token pair. */
export const WORKSPACE_FINALIZE_ENDPOINT = "/api/saas/register/finalize";

export interface WorkspaceFinalizationAddress {
  country: string;
  line1?: string;
  postalCode?: string;
  city?: string;
}

/** The completion form as the visitor left it, plus the confirmed card. */
export interface WorkspaceFinalization {
  tenantAssignmentToken: string;
  workspaceName: string;
  planId: string;
  customerType: "individual" | "business";
  companyName: string;
  vatNumber: string;
  address: WorkspaceFinalizationAddress;
  paymentMethodId: string;
}

export interface WorkspaceFinalizationPayload {
  tenant_assignment_token: string;
  workspaceName: string;
  planId: string;
  customerType: "individual" | "business";
  companyName?: string;
  vatNumber?: string;
  address: WorkspaceFinalizationAddress;
  paymentMethodId: string;
}

/** What `/auth/establish` takes: an endpoint to call, and its body. */
export interface SessionEstablishRequest {
  endpoint: string;
  payload: WorkspaceFinalizationPayload;
}

/**
 * The finalize call, addressed to the frontend server instead of the API.
 *
 * Built in one place because two things have to stay true together: the
 * payload is what `/api/saas/register/finalize` validates, and the endpoint
 * named in the envelope is the one the operator allowed — a page that inlined
 * either would drift from the other.
 *
 * Company fields only travel for a business customer: an individual who typed
 * a company name and switched back would otherwise be invoiced as one.
 *
 * @param finalization Completion form and confirmed payment method
 * @returns Body to POST to `/auth/establish`
 */
export function buildSessionEstablishRequest(
  finalization: WorkspaceFinalization,
): SessionEstablishRequest {
  const isBusiness = finalization.customerType === "business";
  return {
    endpoint: WORKSPACE_FINALIZE_ENDPOINT,
    payload: {
      tenant_assignment_token: finalization.tenantAssignmentToken,
      workspaceName: finalization.workspaceName,
      planId: finalization.planId,
      customerType: finalization.customerType,
      companyName: isBusiness ? finalization.companyName : undefined,
      vatNumber: isBusiness ? finalization.vatNumber : undefined,
      address: finalization.address,
      paymentMethodId: finalization.paymentMethodId,
    },
  };
}
