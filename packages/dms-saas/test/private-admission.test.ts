import { createRequire } from "node:module";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { ImplementInterface } from "@antelopejs/interface-core";
import {
  GetModel,
  RegisterSchema,
} from "@antelopejs/interface-database-decorators";
import { construct, destroy } from "@antelopejs/mongodb";
import {
  TenantModel,
  TenantMemberModel,
  UserInviteModel,
} from "@antelopejs/interface-dms/db";
import { inviteUserToTenant } from "@antelopejs/interface-dms/invites";
import * as auth from "@antelopejs/interface-dms/auth";
import {
  UserModel,
  SessionModel,
  type User,
} from "@antelopejs/interface-dms/auth/db";
import { MongoMemoryReplSet } from "mongodb-memory-server-core";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { setRuntimeConfig, assertAdmissionOpen } from "../src/config";
import { TenantSubscriptionModel, PlanModel } from "../src/db";
import { SaasRegisterApiController } from "../src/routes/public/register";
import { SaasWorkspacesController } from "../src/routes/tenant/workspaces";
import { SaasTenantPlanController } from "../src/routes/tenant/tenant-plan";
import { SaasWorkspacesListController } from "../src/pages/platform/workspaces";

const stripe = vi.hoisted(() => ({ called: vi.fn() }));
vi.mock("../src/stripe/client", () => ({
  getStripeClient: () => {
    stripe.called();
    throw new Error("No Stripe call permitted in complimentary admission");
  },
}));
vi.mock("../src/billing-state", () => ({
  recomputeTenantBillingState: async () => undefined,
}));
vi.mock("../src/data-api", async () => ({
  ...(await import("../src/data-api/platformOwner/plans")),
  ...(await import("../src/data-api/platformOwner/workspaces")),
}));

const require = createRequire(import.meta.url);
const dmsRoot = path.dirname(require.resolve("@antelopejs/dms/package.json"));
interface SignupResult {
  user: Partial<User>;
  access_token: string;
}
interface SignupModule {
  signup: (
    users: UserModel,
    sessions: SessionModel,
    body: unknown,
    agent: string,
    ip: string,
  ) => Promise<SignupResult>;
}
const { signup } = require(
  path.join(dmsRoot, "dist/routes/auth/signup.js"),
) as SignupModule;
const AUTH_CONFIG = {
  jwtSecret: "private-admission-test-only",
  mustValidateEmail: false,
  oauth: {
    allowAccountCreation: false,
    callbackBaseUrl: "https://example.test",
    providers: { google: { clientId: "test", clientSecret: "test" } },
  },
};
const STRIPE_CONFIG = {
  secretKey: "unused",
  webhookSecret: "unused",
  publishableKey: "unused",
};
const CLOSED_ERROR = { status: 403, body: "saas.errors.registration_closed" };
let mongodb: MongoMemoryReplSet;

beforeAll(async () => {
  const modules = require("@antelopejs/interface-core/modules");
  ImplementInterface(
    { ListModules: modules.ListModules },
    { ListModules: async () => ["@antelopejs/dms-saas"] },
  );
  // saas-mode lives in the interface package, not the DMS runtime: requiring it
  // from `dmsRoot` would load a second copy of a module that holds state.
  await require("@antelopejs/interface-dms/utils/saas-mode").detectSaasMode();
  const { applyConfig } = require(path.join(dmsRoot, "dist/config.js"));
  applyConfig({ auth: AUTH_CONFIG });
  const implementation = require(
    path.join(dmsRoot, "dist/implementations/dms-auth/index.js"),
  );
  ImplementInterface(auth, {
    ...implementation,
    sendAdminInviteEmail: async () => undefined,
  });
  mongodb = await MongoMemoryReplSet.create({
    replSet: { count: 1 },
    binary: { version: "8.0.8" },
  });
  await construct({ url: mongodb.getUri(), database: "private-admission" });
  await RegisterSchema("dms-core");
  await RegisterSchema("dms-tenant");
}, 60_000);

afterAll(async () => {
  await destroy();
  await mongodb?.stop();
});
beforeEach(() => {
  vi.clearAllMocks();
  setRuntimeConfig({ stripe: STRIPE_CONFIG, admissionMode: "invitation-only" });
});

function signupBody(email: string, token: string) {
  return {
    name: "Invited Person",
    email,
    password: "InvitedPassw0rd!",
    token,
    lang: "en",
  };
}

async function oauthLogin(
  email: string,
  invite?: string,
): Promise<SignupResult> {
  const { signOAuthState } = require(
    path.join(dmsRoot, "dist/routes/auth/oauth/state.js"),
  );
  const { oauthCallback } = require(
    path.join(dmsRoot, "dist/routes/auth/oauth/callback.js"),
  );
  const state = signOAuthState("google");
  const responses = new Map<string, unknown>([
    [
      "https://oauth2.googleapis.com/token",
      { access_token: "provider-test-token" },
    ],
    [
      "https://openidconnect.googleapis.com/v1/userinfo",
      { sub: email, email, email_verified: true, name: "OAuth Invitee" },
    ],
  ]);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const body = responses.get(url);
      if (!body) throw new Error("Unexpected provider URL");
      return Response.json(body);
    }),
  );
  try {
    return await oauthCallback({
      userModel: GetModel(UserModel),
      sessionModel: GetModel(SessionModel),
      providerId: "google",
      body: { code: "test", state, state_cookie: state, invite },
      userAgent: "test",
      ip: "127.0.0.1",
    });
  } finally {
    vi.unstubAllGlobals();
  }
}

async function assertOAuthInvitation(tenantId: string): Promise<void> {
  const email = `${randomUUID()}@example.test`;
  await expect(oauthLogin(email)).rejects.toMatchObject({
    status: 403,
    body: "error.oauth.registration_disabled",
  });
  expect(await GetModel(UserModel).getByEmail(email)).toBeUndefined();
  const invite = await inviteUserToTenant({ tenantId, email });
  if (invite.kind !== "invited") throw new Error("Expected OAuth invitation");
  const result = await oauthLogin(email, invite.token);
  expect(
    await GetModel(TenantMemberModel, tenantId).getByUser(result.user._id!),
  ).toBeDefined();
  expect(
    await GetModel(UserInviteModel, tenantId).get(invite.inviteId),
  ).toBeUndefined();
  const existingLogin = await oauthLogin(email);
  expect(existingLogin.user._id).toBe(result.user._id);
}

describe("deployment admission", () => {
  it("rejects every public SaaS signup/setup route before validation or Stripe", async () => {
    const controller = new SaasRegisterApiController();
    await expect(controller.createSetupIntent()).rejects.toMatchObject(
      CLOSED_ERROR,
    );
    await expect(controller.register({} as never)).rejects.toMatchObject(
      CLOSED_ERROR,
    );
    await expect(controller.finalize({} as never)).rejects.toMatchObject(
      CLOSED_ERROR,
    );
    await expect(
      controller.describePendingRegistration({
        tenant_assignment_token: "invalid",
      }),
    ).rejects.toMatchObject(CLOSED_ERROR);
    expect(stripe.called).not.toHaveBeenCalled();
  });

  it.each(["required", "optional", "none"] as const)(
    "answers registration_closed before the %s card policy is consulted",
    async (paymentMethod) => {
      setRuntimeConfig({
        stripe: STRIPE_CONFIG,
        admissionMode: "invitation-only",
        registration: { paymentMethod },
      });
      const controller = new SaasRegisterApiController();
      await expect(controller.createSetupIntent()).rejects.toMatchObject(
        CLOSED_ERROR,
      );
      await expect(
        controller.register({
          email: "visitor@example.test",
          password: "VisitorPassw0rd!",
          name: "Visitor",
        }),
      ).rejects.toMatchObject(CLOSED_ERROR);
      expect(stripe.called).not.toHaveBeenCalled();
    },
  );

  it("is reversible and preserves the platform-owner workspace exception", () => {
    expect(() => assertAdmissionOpen()).toThrow();
    expect(() => assertAdmissionOpen(true)).not.toThrow();
    setRuntimeConfig({ stripe: STRIPE_CONFIG, admissionMode: "open" });
    expect(() => assertAdmissionOpen()).not.toThrow();
    setRuntimeConfig({ stripe: STRIPE_CONFIG });
    expect(() => assertAdmissionOpen()).not.toThrow();
  });

  it.each(["invitation-onyl", "", null, false])(
    "rejects invalid deployment admission %s",
    (admissionMode) => {
      expect(() =>
        setRuntimeConfig({ stripe: STRIPE_CONFIG, admissionMode } as never),
      ).toThrow("Invalid dms-saas admissionMode");
      expect(() => assertAdmissionOpen()).toThrow();
    },
  );
});

describe("actual DMS invitation account creation while admission is closed", () => {
  it("creates an owner and colleague from tokens, retains existing-account immediate membership, and blocks self-serve billing", async () => {
    const users = GetModel(UserModel);
    const plans = GetModel(PlanModel);
    const planId = randomUUID();
    await plans.insert({
      _id: planId,
      name: "Assigned",
      price: 49,
      isActive: true,
      isDeleted: false,
    });
    const admin = { _id: randomUUID(), owner: true, language: "en" } as User;
    const controller = new SaasWorkspacesListController();
    controller.planModel = plans;
    controller.tenantModel = GetModel(TenantModel);
    const email = `${randomUUID()}@example.test`;
    const created = await controller.createWorkspace(admin, {
      name: "Invited workspace",
      ownerEmail: email,
      planId,
      freeWorkspace: true,
    });
    expect(created.owner.kind).toBe("invited");
    if (created.owner.kind !== "invited")
      throw new Error("Expected new account invitation");
    const ownerResult = await signup(
      users,
      GetModel(SessionModel),
      signupBody(email, created.owner.token),
      "test",
      "127.0.0.1",
    );
    const owner = await users.get(ownerResult.user._id!);
    expect(owner).toBeDefined();
    const members = GetModel(TenantMemberModel, created.tenantId);
    expect(await members.getByUser(owner!._id)).toMatchObject({
      isTenantOwner: true,
    });
    expect(
      await GetModel(UserInviteModel, created.tenantId).get(
        created.owner.inviteId,
      ),
    ).toBeUndefined();
    await expect(
      signup(
        users,
        GetModel(SessionModel),
        signupBody(email, created.owner.token),
        "test",
        "127.0.0.1",
      ),
    ).rejects.toBeDefined();

    const colleagueEmail = `${randomUUID()}@example.test`;
    const invite = await inviteUserToTenant({
      tenantId: created.tenantId,
      email: colleagueEmail,
      roleIds: ["member"],
    });
    if (invite.kind !== "invited")
      throw new Error("Expected colleague invitation");
    const colleagueResult = await signup(
      users,
      GetModel(SessionModel),
      signupBody(colleagueEmail, invite.token),
      "test",
      "127.0.0.1",
    );
    expect(await members.getByUser(colleagueResult.user._id!)).toMatchObject({
      isTenantOwner: false,
      roleIds: ["member"],
    });

    const existingEmail = `${randomUUID()}@example.test`;
    const [existingId] = await users.insert({
      email: existingEmail,
      name: "Existing",
      owner: false,
    });
    const immediate = await inviteUserToTenant({
      tenantId: created.tenantId,
      email: existingEmail,
    });
    expect(immediate).toEqual({ kind: "added", userId: existingId });
    expect(await members.getByUser(existingId)).toBeDefined();
    const workspaces = new SaasWorkspacesController();
    for (const user of [
      owner!,
      (await users.get(colleagueResult.user._id!))!,
    ]) {
      await expect(
        workspaces.createMine(user, {} as never, {} as never),
      ).rejects.toMatchObject(CLOSED_ERROR);
      await expect(workspaces.setupIntent(user)).rejects.toMatchObject(
        CLOSED_ERROR,
      );
      await expect(workspaces.createOptions(user)).rejects.toMatchObject(
        CLOSED_ERROR,
      );
    }
    const planController = new SaasTenantPlanController();
    planController.tenantModel = GetModel(TenantModel);
    const subscriptions = GetModel(TenantSubscriptionModel, created.tenantId);
    const subscription = await subscriptions.findOne();
    expect(subscription).toMatchObject({
      isComplimentary: true,
      paidUsagePeriods: [],
      stripeSubscriptionId: null,
    });
    const ctx = {
      rawRequest: {
        headers: { authorization: `Bearer ${ownerResult.access_token}` },
      },
    };
    await expect(
      planController.changePlan(
        owner!,
        { planId },
        ctx as never,
        subscriptions,
        {} as never,
      ),
    ).rejects.toMatchObject({
      status: 409,
      body: "saas.errors.plan.complimentary_locked",
    });
    await assertOAuthInvitation(created.tenantId);
    expect(stripe.called).not.toHaveBeenCalled();
  });
});

describe("invitation sign-up never asks for a plan or a card", () => {
  const ADMISSION_MODES = ["open", "invitation-only"] as const;
  const PAYMENT_POLICIES = ["required", "optional", "none"] as const;
  const COMBINATIONS = ADMISSION_MODES.flatMap((admissionMode) =>
    PAYMENT_POLICIES.map((paymentMethod) => ({ admissionMode, paymentMethod })),
  );

  it.each(COMBINATIONS)(
    "joins the inviting workspace under $admissionMode / $paymentMethod",
    async ({ admissionMode, paymentMethod }) => {
      setRuntimeConfig({
        stripe: STRIPE_CONFIG,
        admissionMode,
        registration: { paymentMethod },
      });
      const tenantId = randomUUID();
      await GetModel(TenantModel).insert({
        _id: tenantId,
        name: "Plan-less workspace",
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      const email = `${randomUUID()}@example.test`;
      const invite = await inviteUserToTenant({ tenantId, email });
      if (invite.kind !== "invited") throw new Error("Expected invitation");

      const result = await signup(
        GetModel(UserModel),
        GetModel(SessionModel),
        signupBody(email, invite.token),
        "test",
        "127.0.0.1",
      );

      expect(
        await GetModel(TenantMemberModel, tenantId).getByUser(result.user._id!),
      ).toBeDefined();
      expect(
        await GetModel(TenantSubscriptionModel, tenantId).findOne(),
      ).toBeUndefined();
      expect(stripe.called).not.toHaveBeenCalled();
    },
  );
});
