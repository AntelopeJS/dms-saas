import { describe, expect, it } from "vitest";
import {
  buildSessionEstablishRequest,
  type WorkspaceFinalization,
} from "../frontend-vue/app/composables/useWorkspaceFinalization";
import { frontendModule } from "../src/frontend-module";
import { SaasRegisterApiController } from "../src/routes/public/register";
import { registeredRoute } from "./helpers/routes";
import { SUITE_STRIPE_KEYS } from "./helpers/stripe";

const FINALIZATION: WorkspaceFinalization = {
  tenantAssignmentToken: "tat_test",
  workspaceName: "Acme",
  paymentMethodId: "pm_test",
};

describe("buildSessionEstablishRequest", () => {
  it("addresses the frontend server, naming the API route it must call", () => {
    const { endpoint } = buildSessionEstablishRequest(FINALIZATION);

    expect(
      frontendModule({ stripe: SUITE_STRIPE_KEYS }).authEstablishEndpoints,
    ).toContain(endpoint);
    expect(registeredRoute("POST", endpoint).callback).toBe(
      SaasRegisterApiController.prototype.finalize,
    );
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
