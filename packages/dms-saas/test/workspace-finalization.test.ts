import { describe, expect, it } from "vitest";
import {
  buildSessionEstablishRequest,
  SESSION_ESTABLISH_ENDPOINT,
  type WorkspaceFinalization,
  WORKSPACE_FINALIZE_ENDPOINT,
} from "../frontend-vue/app/composables/useWorkspaceFinalization";

const FINALIZATION: WorkspaceFinalization = {
  tenantAssignmentToken: "tat_test",
  workspaceName: "Acme",
  paymentMethodId: "pm_test",
};

describe("buildSessionEstablishRequest", () => {
  it("addresses the frontend server, naming the API route it must call", () => {
    // The page posts to the loader, not to the API: the session cookie can
    // only be written by the server that owns it, from tokens it fetched
    // itself.
    expect(SESSION_ESTABLISH_ENDPOINT).toBe("/auth/establish");
    expect(buildSessionEstablishRequest(FINALIZATION).endpoint).toBe(
      WORKSPACE_FINALIZE_ENDPOINT,
    );
    expect(WORKSPACE_FINALIZE_ENDPOINT).toBe("/api/saas/register/finalize");
  });

  it("wraps the payload the finalize endpoint validates", () => {
    expect(buildSessionEstablishRequest(FINALIZATION).payload).toEqual({
      tenant_assignment_token: "tat_test",
      workspaceName: "Acme",
      paymentMethodId: "pm_test",
    });
  });

  it("sends no card when the visitor registered without one", () => {
    const request = buildSessionEstablishRequest({
      tenantAssignmentToken: "tat_test",
      workspaceName: "Acme",
    });

    expect(request.payload.paymentMethodId).toBeUndefined();
    expect(request.payload).not.toHaveProperty("planId");
  });

  it("sends no token of its own", () => {
    // The tenant assignment token is the only credential the page holds; an
    // access or refresh token must never reach it, and never leave it.
    const body = JSON.stringify(buildSessionEstablishRequest(FINALIZATION));

    expect(body).not.toContain("access_token");
    expect(body).not.toContain("refresh_token");
  });
});
