import type { RequestContext } from "@antelopejs/interface-api";
import type { User } from "@antelopejs/interface-dms/auth/db";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Plan } from "../src/db";
import type {
  CardDetails,
  WorkspaceBillingProfile,
  WorkspaceProvisioningInput,
} from "../src/workspaces";

const FREE_PLAN = { _id: "plan-free", price: 0 } as Plan;
const PAID_PLAN = { _id: "plan-pro", price: 12 } as Plan;
const PLANS = new Map([FREE_PLAN, PAID_PLAN].map((plan) => [plan._id, plan]));
const PAYMENT_METHOD_ID = "pm_card";
const CREATED_TENANT_ID = "tenant-created";
const NO_CARD: CardDetails = { fingerprint: null, billingAddress: undefined };
const CARD: CardDetails = {
  fingerprint: "fp_card",
  billingAddress: { country: "FR" },
};
const PAYMENT_METHOD_REQUIRED = {
  status: 400,
  body: "saas.errors.workspace.payment_method_required",
};
const COUNTRY_REQUIRED = {
  status: 400,
  body: "saas.errors.billing.country_required",
};

const resolveCardDetails = vi.fn<(id?: string) => Promise<CardDetails>>();
const provisionWorkspace = vi.fn<(input: WorkspaceProvisioningInput) => void>();

vi.mock("../src/config", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/config")>()),
  assertAdmissionOpen: () => undefined,
}));
vi.mock("@antelopejs/interface-dms/request-tenant", () => ({
  getRequestTenantId: () => "tenant-current",
}));
vi.mock("../src/workspaces", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/workspaces")>()),
  resolveCardDetails: (id?: string) => resolveCardDetails(id),
  resolveBillingProfileForNewWorkspace: async (
    _userId: string,
    card: CardDetails,
  ): Promise<WorkspaceBillingProfile> => ({
    customerType: "individual",
    address: card.billingAddress,
  }),
  ensurePlanIsAvailableForCustomer: async (planId: string) => PLANS.get(planId),
  provisionWorkspace: async (input: WorkspaceProvisioningInput) => {
    provisionWorkspace(input);
    return { tenantId: CREATED_TENANT_ID, isTrialing: false };
  },
  rollbackWorkspaceProvisioning: async () => undefined,
}));

const { SaasWorkspacesController } =
  await import("../src/routes/tenant/workspaces");

const user = {
  _id: "user-1",
  email: "user@example.test",
  name: "User",
  owner: false,
} as User;

function createWorkspace(planId: string, paymentMethodId?: string) {
  return new SaasWorkspacesController().createMine(user, {} as RequestContext, {
    workspaceName: "Side project",
    planId,
    paymentMethodId,
  });
}

describe("self-serve workspace creation card requirement", () => {
  beforeEach(() => {
    resolveCardDetails.mockReset();
    resolveCardDetails.mockImplementation(async (id) => (id ? CARD : NO_CARD));
    provisionWorkspace.mockReset();
  });

  it("provisions a free workspace without a card", async () => {
    await expect(createWorkspace(FREE_PLAN._id)).resolves.toEqual({
      tenantId: CREATED_TENANT_ID,
    });
    const [input] = provisionWorkspace.mock.calls[0]!;
    expect(input.userId).toBe(user._id);
    expect(input.card).toEqual(NO_CARD);
    expect(input.payload.paymentMethodId).toBeUndefined();
    expect(input.payload.planId).toBe(FREE_PLAN._id);
  });

  it("refuses a paid plan without a card", async () => {
    await expect(createWorkspace(PAID_PLAN._id)).rejects.toMatchObject(
      PAYMENT_METHOD_REQUIRED,
    );
    expect(provisionWorkspace).not.toHaveBeenCalled();
  });

  it("provisions a free workspace with a card", async () => {
    await expect(
      createWorkspace(FREE_PLAN._id, PAYMENT_METHOD_ID),
    ).resolves.toEqual({ tenantId: CREATED_TENANT_ID });
    const [input] = provisionWorkspace.mock.calls[0]!;
    expect(input.card).toEqual(CARD);
    expect(input.payload.paymentMethodId).toBe(PAYMENT_METHOD_ID);
    expect(input.payload.address).toEqual(CARD.billingAddress);
  });

  it("provisions a paid workspace with a card", async () => {
    await expect(
      createWorkspace(PAID_PLAN._id, PAYMENT_METHOD_ID),
    ).resolves.toEqual({ tenantId: CREATED_TENANT_ID });
    expect(provisionWorkspace).toHaveBeenCalledOnce();
  });

  it("still requires a billing country when a card is given", async () => {
    resolveCardDetails.mockResolvedValue({
      ...CARD,
      billingAddress: undefined,
    });
    await expect(
      createWorkspace(FREE_PLAN._id, PAYMENT_METHOD_ID),
    ).rejects.toMatchObject(COUNTRY_REQUIRED);
    expect(provisionWorkspace).not.toHaveBeenCalled();
  });
});
