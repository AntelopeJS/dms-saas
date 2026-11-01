import { GetModel } from "@antelopejs/interface-database-decorators";
import {
  authenticateRequestUser,
  generateAccessToken,
  generateTenantAssignmentToken,
  sanitizeUser,
  validateRefreshToken,
} from "@antelopejs/interface-dms/auth";
import {
  isCurrentRefreshToken,
  SessionModel,
  type User,
} from "@antelopejs/interface-dms/auth/db";
import { resolveRequestTenantId } from "@antelopejs/interface-dms/request-tenant";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TenantBeingProvisionedPayload } from "../src/hooks/tenant-provisioning";
import {
  bearer,
  buildController,
  buildRegisterBody,
  listen,
  useRegistrationWorld,
  world,
} from "./helpers/registration";
import { createUser, useDmsAuth } from "./helpers/dms";
import { useMongoDatabase } from "./helpers/mongo";
import { useSuiteStripe } from "./helpers/stripe";

useMongoDatabase("registration-oauth");
useSuiteStripe();
const stripe = useRegistrationWorld();
useDmsAuth();

/** The account that entered through OAuth, before it has a workspace. */
let oauthUser: User;

beforeEach(async () => {
  oauthUser = await createUser({ email: "oauth@example.com", name: "O" });
});

describe("the OAuth-entry path carries the same capture", () => {
  async function buildFinalizeBody(
    input: Parameters<typeof buildRegisterBody>[0] = {},
  ) {
    const {
      email: _email,
      password: _password,
      ...shared
    } = buildRegisterBody(input);
    const { token } = await generateTenantAssignmentToken(oauthUser);
    return { ...shared, tenant_assignment_token: token };
  }

  it("answers the token pair the frontend server opens a session from", async () => {
    const response = await buildController().finalize(
      await buildFinalizeBody(),
    );

    const [tenant] = await world.tenants();
    const [session] = await GetModel(SessionModel).getByUserId(oauthUser._id);
    expect(response).toEqual({
      token_type: "Bearer",
      access_token: expect.any(String),
      expires_in: (await generateAccessToken(tenant?._id ?? "", oauthUser))
        .expiresIn,
      refresh_token: expect.any(String),
      user: await sanitizeUser(oauthUser),
    });
    const request = bearer(response.access_token);
    await expect(authenticateRequestUser(request)).resolves.toMatchObject({
      _id: oauthUser._id,
    });
    await expect(resolveRequestTenantId(request)).resolves.toBe(tenant?._id);
    await expect(
      validateRefreshToken(response.refresh_token),
    ).resolves.toMatchObject({
      id: oauthUser._id,
      tenantId: tenant?._id,
      sessionId: session?._id,
    });
  });

  it("stores the issued refresh token through the hashing session API", async () => {
    const controller = buildController();
    const replaceRefreshToken = vi.spyOn(
      controller.sessionModel,
      "replaceRefreshToken",
    );
    const update = vi.spyOn(controller.sessionModel, "update");

    const response = await controller.finalize(await buildFinalizeBody());

    const [session] = await controller.sessionModel.getByUserId(oauthUser._id);
    expect(replaceRefreshToken).toHaveBeenCalledExactlyOnceWith(
      session?._id,
      response.refresh_token,
    );
    expect(update.mock.calls).toEqual([
      [
        session?._id,
        expect.objectContaining({
          refreshTokenHash: expect.not.stringContaining(response.refresh_token),
        }),
      ],
    ]);
    expect(
      session && isCurrentRefreshToken(session, response.refresh_token),
    ).toBe(true);
    expect(JSON.stringify(session)).not.toContain(response.refresh_token);
  });

  it("hands the listener the account that entered through OAuth", async () => {
    const seen: TenantBeingProvisionedPayload[] = [];
    listen((payload) => {
      seen.push(payload);
    });

    await buildController().finalize(
      await buildFinalizeBody({ extras: { referral: "ads" } }),
    );

    expect(seen[0]?.userId).toBe(oauthUser._id);
    expect(seen[0]?.extras).toEqual({ referral: "ads" });
  });

  it("rolls the workspace back but keeps the account it did not create", async () => {
    listen(() => {
      throw new Error("consumer storage is down");
    });

    await expect(
      buildController().finalize(await buildFinalizeBody()),
    ).rejects.toThrow("consumer storage is down");

    expect(await world.tenants()).toEqual([]);
    expect([...stripe.customers]).toEqual([]);
    expect((await world.users()).map((user) => user._id)).toEqual([
      oauthUser._id,
    ]);
  });

  it("applies the same limits to the extras it accepts", async () => {
    await expect(
      buildController().finalize(
        await buildFinalizeBody({ extras: { bio: "x".repeat(5000) } }),
      ),
    ).rejects.toMatchObject({
      status: 400,
      body: "saas.errors.registration.extras_too_large",
    });
  });
});
