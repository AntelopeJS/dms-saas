import { randomUUID } from "node:crypto";
import type { RequestContext } from "@antelopejs/interface-api";
import { GetModel } from "@antelopejs/interface-database-decorators";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  registerSubscriptionAccessGate,
  WORKSPACE_ACCESS_BLOCKED_CODE,
} from "../src/auth/subscription-access-gate";
import { TenantSubscriptionModel } from "../src/db";
import "../src/routes/tenant/billing-self-refund";
import {
  addTenantMember,
  createUser,
  tenantRequest,
  useDmsAuth,
} from "./helpers/dms";
import { useMongoDatabase } from "./helpers/mongo";
import { callRoute } from "./helpers/routes";
import { useSuiteStripe } from "./helpers/stripe";

useMongoDatabase("refund-eligibility-gate");
useDmsAuth();
useSuiteStripe();

const OWNER_REQUIRED = { status: 403, body: "error.tenant_owner_required" };

interface BlockedWorkspace {
  owner: RequestContext;
  member: RequestContext;
}

let workspace: BlockedWorkspace;

beforeAll(() => {
  registerSubscriptionAccessGate();
});

beforeEach(async () => {
  const tenantId = randomUUID();
  const owner = await createUser();
  const member = await createUser();
  await addTenantMember(tenantId, owner, true);
  await addTenantMember(tenantId, member);
  await GetModel(TenantSubscriptionModel, tenantId).insert({
    _id: tenantId,
    planId: "paid",
    status: "cancelled",
  });
  workspace = {
    owner: await tenantRequest(owner, tenantId),
    member: await tenantRequest(member, tenantId),
  };
});

describe("money-back guarantee under the access gate", () => {
  /**
   * The refund cancels the subscription, which blocks the workspace: the card
   * read a 403 and told the owner to pay an unpaid invoice that did not exist.
   */
  it("reads the eligibility of a blocked workspace", async () => {
    await expect(
      callRoute("GET", "/api/saas/billing/refund-eligibility", workspace.owner),
    ).resolves.toMatchObject({ eligible: false });
    await expect(
      callRoute(
        "GET",
        "/api/saas/billing/refund-eligibility",
        workspace.member,
      ),
    ).rejects.toMatchObject(OWNER_REQUIRED);
  });

  it("keeps the refund itself behind the access gate", async () => {
    await expect(
      callRoute("POST", "/api/saas/billing/refund-self", workspace.owner),
    ).rejects.toMatchObject({
      status: 403,
      body: WORKSPACE_ACCESS_BLOCKED_CODE,
    });
    await expect(
      callRoute("POST", "/api/saas/billing/refund-self", workspace.member),
    ).rejects.toMatchObject(OWNER_REQUIRED);
  });
});
