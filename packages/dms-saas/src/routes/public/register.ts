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
import { resolveEntryProvider } from "../../auth";
import { assertAdmissionOpen } from "../../config";
import { createCardSetupIntent } from "../../stripe";
import type {
  StripeCustomerProfile,
  WorkspaceProvisioningHandles,
  WorkspaceProvisioningPayload,
} from "../../workspaces";
import {
  assertBillingCountry,
  assertRegistrationExtras,
  ensurePlanIsAvailableForCustomer,
  provisionWorkspace,
  resolveCardDetails,
  rollbackWorkspaceProvisioning,
} from "../../workspaces";

const HTTP_BAD_REQUEST = 400;
const AUTH_KEY_BYTES = 32;

interface RegisterBody extends WorkspaceProvisioningPayload {
  email: string;
  password: string;
  name: string;
}

interface FinalizeBody extends WorkspaceProvisioningPayload {
  tenant_assignment_token: string;
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

function generateAuthKey(): string {
  return randomBytes(AUTH_KEY_BYTES).toString("hex");
}

function toStripeProfile(
  payload: WorkspaceProvisioningPayload,
  email: string,
  fallbackName: string,
): StripeCustomerProfile {
  return {
    email,
    fallbackName,
    customerType: payload.customerType,
    companyName: payload.companyName,
    vatNumber: payload.vatNumber,
    address: payload.address,
    paymentMethodId: payload.paymentMethodId,
  };
}

export class SaasRegisterApiController extends Controller(
  "/api/saas/register",
) {
  @Model(UserModel)
  declare userModel: UserModel;

  @Model(SessionModel)
  declare sessionModel: SessionModel;

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
    await this.sessionModel.update(sessionId, {
      refreshToken: refreshTokenData.token,
    });
    return {
      token_type: "Bearer",
      access_token: accessTokenData.token,
      expires_in: accessTokenData.expiresIn,
      refresh_token: refreshTokenData.token,
      user: await sanitizeUser(user),
    };
  }

  @Get("/setup-intent")
  async createSetupIntent(): Promise<SetupIntentResponse> {
    assertAdmissionOpen();
    return createCardSetupIntent();
  }

  @Post("/")
  async register(@JSONBody() body: RegisterBody): Promise<RegisterResult> {
    assertAdmissionOpen();
    assertBillingCountry(body.address);
    assertRegistrationExtras(body.extras);
    await ensurePlanIsAvailableForCustomer(body.planId, body.customerType);
    await this.ensureEmailAvailable(body.email);

    const handles: WorkspaceProvisioningHandles = {};
    try {
      handles.userId = await this.createInitialUser(body);
      const { tenantId } = await provisionWorkspace({
        userId: handles.userId,
        payload: body,
        stripeCustomerProfile: toStripeProfile(body, body.email, body.name),
        card: await resolveCardDetails(body.paymentMethodId),
        handles,
      });
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
    assertBillingCountry(body.address);
    assertRegistrationExtras(body.extras);
    const { user } = await validateTenantAssignmentToken(
      body.tenant_assignment_token,
    );
    await this.ensureNoWorkspaceYet(user._id);

    await ensurePlanIsAvailableForCustomer(body.planId, body.customerType);

    const handles: WorkspaceProvisioningHandles = { userId: user._id };
    try {
      const { tenantId } = await provisionWorkspace({
        userId: user._id,
        payload: body,
        stripeCustomerProfile: toStripeProfile(body, user.email, user.name),
        card: await resolveCardDetails(body.paymentMethodId),
        handles,
      });
      return await this.issueAuthResponse(user, tenantId);
    } catch (error) {
      await rollbackWorkspaceProvisioning(handles);
      throw error;
    }
  }
}
