import { randomBytes } from "node:crypto";
import {
  Controller,
  Get,
  JSONBody,
  Parameter,
  Post,
} from "@antelopejs/interface-api";
import { assert } from "@antelopejs/interface-api-util";
import { Logging } from "@antelopejs/interface-core/logging";
import { CROSS_INSTANCE } from "@antelopejs/interface-database";
import { GetModel, Model } from "@antelopejs/interface-database-decorators";
import { TenantMemberModel } from "@antelopejs/interface-dms/db";
import {
  createSession,
  generateAccessToken,
  generateRefreshToken,
  getExternalIdentities,
  sanitizeUser,
  validateTenantAssignmentToken,
} from "@antelopejs/interface-dms/auth";
import {
  SessionModel,
  type User,
  UserModel,
} from "@antelopejs/interface-dms/auth/db";
import { isPasswordCompliant } from "@antelopejs/interface-dms/auth/password";
import { resolveEntryProvider } from "../../auth";
import {
  assertAdmissionOpen,
  assertRegistrationCardAccepted,
  resolveRegistrationPaymentMethodId,
} from "../../config";
import { type Plan, PlanModel } from "../../db";
import { createCardSetupIntent } from "../../stripe";
import {
  CONTENT_LANGUAGE_HEADER,
  requestLocale,
} from "../../utils/content-language";
import type {
  CardDetails,
  WorkspaceBillingProfile,
  WorkspaceProvisioningHandles,
  WorkspaceProvisioningInput,
} from "../../workspaces";
import {
  assertCardMayBackFreeWorkspace,
  assertRegistrationExtras,
  isFreePerCardPolicyActive,
  provisionWorkspace,
  resolveCardDetails,
  resolveFreeWorkspacesPerCard,
  resolveRegistrationPlan,
  rollbackWorkspaceProvisioning,
} from "../../workspaces";
import {
  findPlanByReference,
  loadPublicBillingRules,
  loadPublicPlanCatalog,
  type PublicBillingRules,
  type PublicPlan,
} from "./public-plan-catalog";
import type { TenantPlanFeature } from "../../plans";

const HTTP_BAD_REQUEST = 400;
const AUTH_KEY_BYTES = 32;
/** Renamable from the workspace settings; the screens send a localised one. */
const DEFAULT_WORKSPACE_NAME = "My workspace";

/**
 * What a registration asks for on top of the account: nothing but the
 * optional card. Plan, customer type and billing address belong to the
 * upgrade flow, so every registration lands on the free plan.
 */
interface RegistrationPayload {
  workspaceName?: string;
  paymentMethodId?: string;
  /**
   * The consuming SaaS's own capture, handed to `TENANT_BEING_PROVISIONED`
   * listeners and nowhere else.
   */
  extras?: Record<string, unknown>;
}

interface RegisterBody extends RegistrationPayload {
  email: string;
  password: string;
  name: string;
}

interface FinalizeBody extends RegistrationPayload {
  tenant_assignment_token: string;
}

/** Everything settled before an account or a Stripe object exists. */
interface AdmittedRegistration {
  plan: Plan;
  paymentMethodId: string | undefined;
  card: CardDetails;
}

interface RegistrationAccount {
  userId: string;
  email: string;
  name: string;
}

interface PendingRegistrationBody {
  tenant_assignment_token: string;
}

interface PendingRegistration {
  email: string;
  name: string;
  provider: string | null;
}

interface AuthResponse {
  token_type: string;
  access_token: string;
  expires_in: number;
  refresh_token: string;
  user: Partial<User>;
}

interface SetupIntentResponse {
  clientSecret: string | null;
}

interface RegisterResult {
  userId: string;
  tenantId: string;
}

/**
 * What the sign-up screens show about the plan: the one the workspace opens
 * on, and the paid plan the visitor picked on the pricing page, reviewed on
 * Billing right after.
 */
interface RegistrationPlanSummary {
  plan: PublicPlan;
  requestedPlan: PublicPlan | null;
  features: TenantPlanFeature[];
  rules: PublicBillingRules;
}

function generateAuthKey(): string {
  return randomBytes(AUTH_KEY_BYTES).toString("hex");
}

/**
 * Hold a password-based registration to the DMS password policy, before the
 * e-mail is looked up and before any account or Stripe object exists. The
 * OAuth completion has no password and never comes through here.
 */
function assertRegistrationPassword(password: unknown): void {
  assert(
    typeof password === "string" && isPasswordCompliant(password),
    HTTP_BAD_REQUEST,
    "saas.errors.registration.password_policy",
  );
}

/**
 * A registration always opens a free workspace, so its card is held to the
 * billing rules' free workspaces per card, like a workspace created from the
 * app. A card-less registration has no fingerprint to count.
 */
async function assertRegistrationCardMayBackFreeWorkspace(
  card: CardDetails,
): Promise<void> {
  if (!card.fingerprint) return;
  const limit = await resolveFreeWorkspacesPerCard();
  if (!isFreePerCardPolicyActive(limit)) return;
  await assertCardMayBackFreeWorkspace(card.fingerprint, limit);
}

/**
 * Validate a registration against the deployment before anything is created:
 * the card policy and the card's free workspaces, the extras bounds, and the
 * free plan it will land on.
 */
async function admitRegistration(
  body: RegistrationPayload,
): Promise<AdmittedRegistration> {
  const paymentMethodId = resolveRegistrationPaymentMethodId(
    body.paymentMethodId,
  );
  assertRegistrationExtras(body.extras);
  const plan = await resolveRegistrationPlan();
  const card = await resolveCardDetails(paymentMethodId);
  await assertRegistrationCardMayBackFreeWorkspace(card);
  return { plan, paymentMethodId, card };
}

/**
 * The provisioning call for a registration. The billing profile starts as an
 * individual one, addressed where the card is when there is a card: the
 * upgrade flow collects the rest.
 */
async function buildRegistrationProvisioning(
  account: RegistrationAccount,
  body: RegistrationPayload,
  admitted: AdmittedRegistration,
  handles: WorkspaceProvisioningHandles,
): Promise<WorkspaceProvisioningInput> {
  const { card } = admitted;
  const billingProfile: WorkspaceBillingProfile = {
    customerType: "individual",
    address: card.billingAddress,
  };
  return {
    userId: account.userId,
    payload: {
      ...billingProfile,
      workspaceName: body.workspaceName?.trim() || DEFAULT_WORKSPACE_NAME,
      planId: admitted.plan._id,
      paymentMethodId: admitted.paymentMethodId,
      extras: body.extras,
    },
    stripeCustomerProfile: {
      ...billingProfile,
      email: account.email,
      fallbackName: account.name,
    },
    card,
    handles,
  };
}

export class SaasRegisterApiController extends Controller(
  "/api/saas/register",
) {
  @Model(UserModel)
  declare userModel: UserModel;

  @Model(SessionModel)
  declare sessionModel: SessionModel;

  @Model(PlanModel)
  declare planModel: PlanModel;

  @Parameter("user-agent", "header")
  declare userAgent: string;

  @Parameter("x-forwarded-for", "header")
  declare forwardedFor: string;

  private async ensureEmailAvailable(email: string): Promise<void> {
    const existing = await this.userModel.getByEmail(email);
    assert(!existing, HTTP_BAD_REQUEST, "saas.errors.user.email_in_use");
  }

  private async ensureNoWorkspaceYet(userId: string): Promise<void> {
    const memberModel = GetModel(TenantMemberModel, CROSS_INSTANCE);
    const alreadyHasWorkspace = await memberModel.existsByUser(userId);
    assert(
      !alreadyHasWorkspace,
      HTTP_BAD_REQUEST,
      "saas.errors.user.already_has_workspace",
    );
  }

  private async createInitialUser(body: RegisterBody): Promise<string> {
    const userInsert = await this.userModel.insert([
      {
        email: body.email,
        name: body.name,
        password: body.password,
        authKey: generateAuthKey(),
        owner: false,
        createdAt: new Date(),
      },
    ]);
    return userInsert[0];
  }

  private async issueAuthResponse(
    user: User,
    tenantId: string,
  ): Promise<AuthResponse> {
    const sessionId = await createSession(
      this.sessionModel,
      user._id,
      this.userAgent || "",
      this.forwardedFor || "",
    );
    const accessTokenData = await generateAccessToken(
      tenantId,
      user,
      sessionId,
    );
    const refreshTokenData = await generateRefreshToken(
      tenantId,
      user,
      sessionId,
    );
    await this.sessionModel.replaceRefreshToken(
      sessionId,
      refreshTokenData.token,
    );
    return {
      token_type: "Bearer",
      access_token: accessTokenData.token,
      expires_in: accessTokenData.expiresIn,
      refresh_token: refreshTokenData.token,
      user: await sanitizeUser(user),
    };
  }

  /**
   * The plan a registration opens the workspace on, plus the one the visitor
   * chose on the pricing page when it is another public plan. Display only:
   * registration still lands on the default plan whatever is asked for.
   *
   * @param reference Slug or id of the chosen plan, from `?plan=`
   * @param language Reader's locale, for the feature labels
   */
  @Get("/plan")
  async describeRegistrationPlan(
    @Parameter("plan", "query") reference: unknown,
    @Parameter(CONTENT_LANGUAGE_HEADER, "header") language: unknown,
  ): Promise<RegistrationPlanSummary> {
    assertAdmissionOpen();
    const [plan, publicPlans, rules] = await Promise.all([
      resolveRegistrationPlan(),
      this.planModel.findPubliclyVisible(),
      loadPublicBillingRules(),
    ]);
    const requested = findPlanByReference(publicPlans, reference);
    const isAnotherPlan = !!requested && requested._id !== plan._id;
    const shown = isAnotherPlan && requested ? [plan, requested] : [plan];
    const catalog = await loadPublicPlanCatalog(shown, requestLocale(language));
    const byId = new Map(catalog.plans.map((entry) => [entry._id, entry]));
    return {
      plan: byId.get(plan._id) ?? catalog.plans[0]!,
      requestedPlan: isAnotherPlan ? (byId.get(requested._id) ?? null) : null,
      features: catalog.features,
      rules,
    };
  }

  @Get("/setup-intent")
  async createSetupIntent(): Promise<SetupIntentResponse> {
    assertAdmissionOpen();
    assertRegistrationCardAccepted();
    return createCardSetupIntent();
  }

  @Post("/")
  async register(@JSONBody() body: RegisterBody): Promise<RegisterResult> {
    assertAdmissionOpen();
    assertRegistrationPassword(body.password);
    const admitted = await admitRegistration(body);
    await this.ensureEmailAvailable(body.email);

    const handles: WorkspaceProvisioningHandles = {};
    try {
      handles.userId = await this.createInitialUser(body);
      const account = {
        userId: handles.userId,
        email: body.email,
        name: body.name,
      };
      const { tenantId } = await provisionWorkspace(
        await buildRegistrationProvisioning(account, body, admitted, handles),
      );
      return { userId: handles.userId, tenantId };
    } catch (error) {
      await rollbackWorkspaceProvisioning(handles);
      if (handles.userId && !handles.mustPreserveWorkspace) {
        await this.userModel.delete(handles.userId).catch((cleanupError) => {
          Logging.Error(
            `[dms-saas:register] rollback failed to delete user ${handles.userId}`,
            cleanupError,
          );
        });
      }
      throw error;
    }
  }

  /**
   * Describe the account a pending registration will provision for, so the
   * completion screen can name the identity about to own — and pay for — the
   * workspace, and refuse an account that already has one before a card is
   * ever asked for.
   *
   * The tenant assignment token travels in the body, never in the query
   * string: it is the same 15-minute credential `finalize` consumes, and a URL
   * would hand it to every access log between the browser and the API.
   *
   * @param body Tenant assignment token relayed by the completion screen
   * @returns Account e-mail, display name, and the provider it entered with
   */
  @Post("/pending")
  async describePendingRegistration(
    @JSONBody() body: PendingRegistrationBody,
  ): Promise<PendingRegistration> {
    assertAdmissionOpen();
    const { user } = await validateTenantAssignmentToken(
      body.tenant_assignment_token,
    );
    await this.ensureNoWorkspaceYet(user._id);

    return {
      email: user.email,
      name: user.name,
      provider: resolveEntryProvider(await getExternalIdentities(user._id)),
    };
  }

  @Post("/finalize")
  async finalize(@JSONBody() body: FinalizeBody): Promise<AuthResponse> {
    assertAdmissionOpen();
    const admitted = await admitRegistration(body);
    const { user } = await validateTenantAssignmentToken(
      body.tenant_assignment_token,
    );
    await this.ensureNoWorkspaceYet(user._id);

    const handles: WorkspaceProvisioningHandles = { userId: user._id };
    try {
      const account = { userId: user._id, email: user.email, name: user.name };
      const { tenantId } = await provisionWorkspace(
        await buildRegistrationProvisioning(account, body, admitted, handles),
      );
      return await this.issueAuthResponse(user, tenantId);
    } catch (error) {
      await rollbackWorkspaceProvisioning(handles);
      throw error;
    }
  }
}
