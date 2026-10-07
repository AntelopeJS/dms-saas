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
const PAID_PLAN = { _id: "plan-pro", price: 1200 } as Plan;
const PLANS = new Map([FREE_PLAN, PAID_PLAN].map((plan) => [plan._id, plan]));
const PAYMENT_METHOD_ID = "pm_card";
const CREATED_TENANT_ID = "tenant-created";
const POLICY_OFF = 0;
const ONE_PER_CARD = 1;
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
const FREE_CARD_LIMIT = {
  status: 409,
  body: "saas.errors.workspace.free_card_limit_reached",
};
const CREATION_IN_PROGRESS = {
  status: 409,
  body: "saas.errors.workspace.creation_in_progress",
};
const NAME_TOO_LONG = {
  status: 400,
  body: "saas.errors.workspace.name_too_long",
};

const policy = vi.hoisted(() => ({ freeWorkspacesPerCard: 1 }));
const resolveCardDetails = vi.fn<(id?: string) => Promise<CardDetails>>();
const provisionWorkspace = vi.fn<(input: WorkspaceProvisioningInput) => void>();
const assertCardMayBackFreeWorkspace =
  vi.fn<(fingerprint: string, limit: number) => Promise<void>>();

vi.mock("../src/config", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/config")>()),
  assertAdmissionOpen: () => undefined,
}));
vi.mock("@antelopejs/interface-dms/request-tenant", () => ({
  getRequestTenantId: () => "tenant-current",
}));
vi.mock(
  "../src/workspaces/free-workspaces-per-card",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("../src/workspaces/free-workspaces-per-card")
    >()),
    resolveFreeWorkspacesPerCard: async () => policy.freeWorkspacesPerCard,
    assertCardMayBackFreeWorkspace: (fingerprint: string, limit: number) =>
      assertCardMayBackFreeWorkspace(fingerprint, limit),
  }),
);
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

function createWorkspace(
  planId: string,
  paymentMethodId?: string,
  workspaceName = "Side project",
) {
  return new SaasWorkspacesController().createMine(user, {} as RequestContext, {
    workspaceName,
    planId,
    paymentMethodId,
  });
}

function provisioned(): WorkspaceProvisioningInput {
  const [input] = provisionWorkspace.mock.calls[0]!;
  return input;
}

describe("self-serve workspace creation card rules", () => {
  beforeEach(() => {
    policy.freeWorkspacesPerCard = ONE_PER_CARD;
    resolveCardDetails.mockReset();
    resolveCardDetails.mockImplementation(async (id) => (id ? CARD : NO_CARD));
    provisionWorkspace.mockReset();
    assertCardMayBackFreeWorkspace.mockReset();
    assertCardMayBackFreeWorkspace.mockResolvedValue(undefined);
  });

  it("provisions a free workspace without a card when the per-card rule is off", async () => {
    policy.freeWorkspacesPerCard = POLICY_OFF;

    await expect(createWorkspace(FREE_PLAN._id)).resolves.toEqual({
      tenantId: CREATED_TENANT_ID,
    });
    expect(provisioned().card).toEqual(NO_CARD);
    expect(provisioned().payload.paymentMethodId).toBeUndefined();
  });

  it("ignores a card sent for a free plan when the per-card rule is off", async () => {
    policy.freeWorkspacesPerCard = POLICY_OFF;

    await createWorkspace(FREE_PLAN._id, PAYMENT_METHOD_ID);

    expect(provisioned().card).toEqual(NO_CARD);
    expect(provisioned().payload.paymentMethodId).toBeUndefined();
    expect(assertCardMayBackFreeWorkspace).not.toHaveBeenCalled();
  });

  it("asks for a card on a free plan under the per-card rule", async () => {
    await expect(createWorkspace(FREE_PLAN._id)).rejects.toMatchObject(
      PAYMENT_METHOD_REQUIRED,
    );
    expect(provisionWorkspace).not.toHaveBeenCalled();
  });

  it("verifies a free workspace's card without handing it over to be charged", async () => {
    resolveCardDetails.mockResolvedValue({
      ...CARD,
      billingAddress: undefined,
    });

    await expect(
      createWorkspace(FREE_PLAN._id, PAYMENT_METHOD_ID),
    ).resolves.toEqual({ tenantId: CREATED_TENANT_ID });
    expect(assertCardMayBackFreeWorkspace).toHaveBeenCalledWith(
      CARD.fingerprint,
      ONE_PER_CARD,
    );
    expect(provisioned().card.fingerprint).toBe(CARD.fingerprint);
    expect(provisioned().payload.paymentMethodId).toBeUndefined();
  });

  it("refuses a free workspace once its card backs as many as allowed", async () => {
    assertCardMayBackFreeWorkspace.mockRejectedValue(FREE_CARD_LIMIT);

    await expect(
      createWorkspace(FREE_PLAN._id, PAYMENT_METHOD_ID),
    ).rejects.toMatchObject(FREE_CARD_LIMIT);
    expect(provisionWorkspace).not.toHaveBeenCalled();
  });

  it("refuses a paid plan without a card", async () => {
    await expect(createWorkspace(PAID_PLAN._id)).rejects.toMatchObject(
      PAYMENT_METHOD_REQUIRED,
    );
    expect(provisionWorkspace).not.toHaveBeenCalled();
  });

  it("provisions a paid workspace with its card to be charged", async () => {
    await expect(
      createWorkspace(PAID_PLAN._id, PAYMENT_METHOD_ID),
    ).resolves.toEqual({ tenantId: CREATED_TENANT_ID });
    expect(provisioned().payload.paymentMethodId).toBe(PAYMENT_METHOD_ID);
    expect(provisioned().payload.address).toEqual(CARD.billingAddress);
    expect(assertCardMayBackFreeWorkspace).not.toHaveBeenCalled();
  });

  it("still requires a billing country on a paid plan", async () => {
    resolveCardDetails.mockResolvedValue({
      ...CARD,
      billingAddress: undefined,
    });

    await expect(
      createWorkspace(PAID_PLAN._id, PAYMENT_METHOD_ID),
    ).rejects.toMatchObject(COUNTRY_REQUIRED);
    expect(provisionWorkspace).not.toHaveBeenCalled();
  });

  it("refuses a second creation racing with the same card", async () => {
    let release: () => void = () => undefined;
    assertCardMayBackFreeWorkspace.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );

    const first = createWorkspace(FREE_PLAN._id, PAYMENT_METHOD_ID);
    await vi.waitFor(() =>
      expect(assertCardMayBackFreeWorkspace).toHaveBeenCalledOnce(),
    );
    await expect(
      createWorkspace(FREE_PLAN._id, PAYMENT_METHOD_ID),
    ).rejects.toMatchObject(CREATION_IN_PROGRESS);
    release();
    await expect(first).resolves.toEqual({ tenantId: CREATED_TENANT_ID });
    await expect(
      createWorkspace(PAID_PLAN._id, PAYMENT_METHOD_ID),
    ).resolves.toEqual({ tenantId: CREATED_TENANT_ID });
  });

  it("refuses a name longer than the forms allow", async () => {
    await expect(
      createWorkspace(PAID_PLAN._id, PAYMENT_METHOD_ID, "x".repeat(61)),
    ).rejects.toMatchObject(NAME_TOO_LONG);
  });
});
