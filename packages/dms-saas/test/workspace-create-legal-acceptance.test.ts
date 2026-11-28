import { randomUUID } from "node:crypto";
import type { RequestContext } from "@antelopejs/interface-api";
import { GetModel } from "@antelopejs/interface-database-decorators";
import type { User } from "@antelopejs/interface-dms/auth/db";
import { TenantModel } from "@antelopejs/interface-dms/db";
import {
  Hook,
  RegisterHook,
  UnregisterHook,
} from "@antelopejs/interface-dms/hooks";
import * as permissions from "@antelopejs/interface-dms/permissions";
import { fromAny, fromPartial } from "@total-typescript/shoehorn";
import type Stripe from "stripe";
import {
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  onTestFinished,
  vi,
} from "vitest";
import {
  BILLING_SETTINGS_SINGLETON_ID,
  BillingSettingsModel,
  LegalDocumentsModel,
} from "../src/db";
import { saveLegalDocuments } from "../src/operator-billing";
import { SaasWorkspacesController } from "../src/routes/tenant/workspaces";
import { LegalAcceptanceModel } from "../src/workspaces/db/legal-acceptance.model";
import {
  addTenantMember,
  createUser,
  implementWithDms,
  tenantRequest,
  useDmsAuth,
} from "./helpers/dms";
import { useMongoDatabase } from "./helpers/mongo";
import { insertPlan } from "./helpers/plans";
import { useSuiteStripe } from "./helpers/stripe";
import { insertTenant } from "./helpers/workspaces";

useMongoDatabase();
useDmsAuth();
const stripe = useSuiteStripe();

const FREE_PLAN_ID = "plan-free";
const PAYMENT_METHOD_ID = "pm_card";
const POLICY_OFF = 0;
const ONE_PER_CARD = 1;
const FIRST_PUBLICATION = new Date("2026-03-12T10:00:00Z");
const SECOND_PUBLICATION = new Date("2026-10-07T12:00:00Z");
const LEGAL_ACCEPTANCE_REQUIRED = {
  status: 400,
  body: "saas.errors.workspace.legal_acceptance_required",
};
const PAYMENT_METHOD_REQUIRED = {
  status: 400,
  body: "saas.errors.workspace.payment_method_required",
};

type CreateBody = Parameters<SaasWorkspacesController["createMine"]>[2];

/** The body of the Create workspace form, as a client may send it. */
type SentBody = Partial<Omit<CreateBody, "hasAcceptedLegal">> & {
  hasAcceptedLegal?: unknown;
};

let user: User;
let request: RequestContext;
let retrieveCard: ReturnType<typeof vi.spyOn>;

beforeAll(async () => {
  implementWithDms(permissions, "implementations/dms/permissions.js");
  await insertPlan({ _id: FREE_PLAN_ID });
});

async function setFreeWorkspacesPerCard(limit: number): Promise<void> {
  const settings = GetModel(BillingSettingsModel);
  await settings.delete(BILLING_SETTINGS_SINGLETON_ID);
  await settings.insert({
    _id: BILLING_SETTINGS_SINGLETON_ID,
    maxFreeWorkspacesPerCard: limit,
  });
}

/** Publishes both documents, then a second version of the terms and conditions. */
async function publishLegalDocuments(): Promise<void> {
  const model = GetModel(LegalDocumentsModel);
  await saveLegalDocuments(
    model,
    { termsAndConditions: "<p>Terms v1</p>", privacyPolicy: "<p>Privacy</p>" },
    FIRST_PUBLICATION,
  );
  await saveLegalDocuments(
    model,
    { termsAndConditions: "<p>Terms v2</p>" },
    SECOND_PUBLICATION,
  );
}

beforeEach(async () => {
  retrieveCard = vi
    .spyOn(stripe.write.paymentMethods, "retrieve")
    .mockResolvedValue(
      fromPartial<Stripe.Response<Stripe.PaymentMethod>>({
        card: { fingerprint: randomUUID() },
        billing_details: { address: null },
      }),
    );
  const currentTenantId = randomUUID();
  await insertTenant(currentTenantId);
  user = await createUser();
  await addTenantMember(currentTenantId, user);
  request = await tenantRequest(user, currentTenantId);
  await setFreeWorkspacesPerCard(POLICY_OFF);
  await GetModel(LegalAcceptanceModel).table.delete().run();
  await GetModel(LegalDocumentsModel).table.delete().run();
});

function createWorkspace(body: SentBody) {
  return new SaasWorkspacesController().createMine(
    user,
    request,
    fromAny<CreateBody, SentBody>({
      workspaceName: "Side project",
      planId: FREE_PLAN_ID,
      ...body,
    }),
  );
}

async function workspaceCount(): Promise<number> {
  return (await GetModel(TenantModel).getAll()).length;
}

function acceptances() {
  return GetModel(LegalAcceptanceModel).getAll();
}

/** Makes every provisioning fail once the workspace exists, until the test ends. */
function failProvisioning(): void {
  const listener = async () => {
    throw new Error("the consumer's listener failed");
  };
  RegisterHook(Hook.TENANT_BEING_PROVISIONED, listener);
  onTestFinished(() => UnregisterHook(Hook.TENANT_BEING_PROVISIONED, listener));
}

describe("the legal acceptance of a self-serve workspace creation", () => {
  it("refuses a creation without the acceptance, before reading the card", async () => {
    const before = await workspaceCount();

    await expect(
      createWorkspace({ paymentMethodId: PAYMENT_METHOD_ID }),
    ).rejects.toMatchObject(LEGAL_ACCEPTANCE_REQUIRED);

    expect(retrieveCard).not.toHaveBeenCalled();
    expect(await workspaceCount()).toBe(before);
    expect(await acceptances()).toEqual([]);
  });

  it("accepts nothing but the ticked checkbox", async () => {
    for (const notTicked of [false, "true", 1, null]) {
      await expect(
        createWorkspace({ hasAcceptedLegal: notTicked }),
      ).rejects.toMatchObject(LEGAL_ACCEPTANCE_REQUIRED);
    }
    expect(await acceptances()).toEqual([]);
  });

  it("records the acceptance with the versions published then and the server's time", async () => {
    await publishLegalDocuments();
    const before = new Date();

    const { tenantId } = await createWorkspace({ hasAcceptedLegal: true });

    const acceptance = await GetModel(LegalAcceptanceModel).get(tenantId);
    expect(acceptance).toMatchObject({
      _id: tenantId,
      userId: user._id,
      source: "workspace_creation",
      documents: {
        termsAndConditions: { version: 2, publishedAt: SECOND_PUBLICATION },
        privacyPolicy: { version: 1, publishedAt: FIRST_PUBLICATION },
      },
    });
    expect(acceptance?.acceptedAt.getTime()).toBeGreaterThanOrEqual(
      before.getTime(),
    );
    expect(acceptance?.acceptedAt.getTime()).toBeLessThanOrEqual(Date.now());
    expect(await acceptances()).toHaveLength(1);
  });

  it("records an acceptance of unpublished documents as version 0", async () => {
    const { tenantId } = await createWorkspace({ hasAcceptedLegal: true });

    expect(await GetModel(LegalAcceptanceModel).get(tenantId)).toMatchObject({
      documents: {
        termsAndConditions: { version: 0, publishedAt: null },
        privacyPolicy: { version: 0, publishedAt: null },
      },
    });
  });

  it("records no acceptance for a creation the card rules refuse", async () => {
    await setFreeWorkspacesPerCard(ONE_PER_CARD);

    await expect(
      createWorkspace({ hasAcceptedLegal: true }),
    ).rejects.toMatchObject(PAYMENT_METHOD_REQUIRED);

    expect(await acceptances()).toEqual([]);
  });

  it("forgets the acceptance of a creation rolled back after the workspace existed", async () => {
    failProvisioning();
    const before = await workspaceCount();

    await expect(createWorkspace({ hasAcceptedLegal: true })).rejects.toThrow(
      "the consumer's listener failed",
    );

    expect(await workspaceCount()).toBe(before);
    expect(await acceptances()).toEqual([]);
  });
});
