import { generateTenantAssignmentToken } from "@antelopejs/interface-dms/auth";
import type { User } from "@antelopejs/interface-dms/auth/db";
import { beforeEach, describe, expect, it } from "vitest";
import {
  buildController,
  buildRegisterBody,
  useRegistrationWorld,
  world,
} from "./helpers/registration";
import { ANY_DATE } from "./helpers/asymmetric-matchers";
import { createUser, useDmsAuth } from "./helpers/dms";
import { useMongoDatabase } from "./helpers/mongo";
import { useSuiteStripe } from "./helpers/stripe";

useMongoDatabase();
useSuiteStripe();
useRegistrationWorld();
useDmsAuth();

/** The account that entered through OAuth, before it has a workspace. */
let oauthUser: User;

beforeEach(async () => {
  oauthUser = await createUser({ email: "oauth@example.com", name: "O" });
});

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

describe("the legal acceptance of a registration", () => {
  it("records the password registration's acceptance like a workspace creation's", async () => {
    const { userId, tenantId } = await buildController().register(
      buildRegisterBody({ hasAcceptedLegal: true }),
    );

    expect(await world.legalAcceptances()).toEqual([
      expect.objectContaining({
        _id: tenantId,
        userId,
        source: "registration",
        documents: {
          termsAndConditions: { version: 0, publishedAt: null },
          privacyPolicy: { version: 0, publishedAt: null },
        },
        acceptedAt: ANY_DATE,
      }),
    ]);
  });

  it("records the OAuth completion's acceptance the same way", async () => {
    await buildController().finalize(
      await buildFinalizeBody({ hasAcceptedLegal: true }),
    );

    const [tenant] = await world.tenants();
    expect(await world.legalAcceptances()).toEqual([
      expect.objectContaining({
        _id: tenant?._id,
        userId: oauthUser._id,
        source: "registration",
      }),
    ]);
  });

  it("records no acceptance a registration did not claim", async () => {
    await buildController().register(buildRegisterBody());
    await buildController().finalize(await buildFinalizeBody());

    expect(await world.tenants()).toHaveLength(2);
    expect(await world.legalAcceptances()).toEqual([]);
  });
});
