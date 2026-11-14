import { HTTPResult } from "@antelopejs/interface-api";
import type {
  JsonObject,
  JsonValue,
} from "@antelopejs/interface-dms-saas/json";
import { fromAny } from "@total-typescript/shoehorn";
import { describe, expect, it } from "vitest";
import {
  buildController,
  buildRegisterBody,
  useRegistrationWorld,
  world,
} from "./helpers/registration";
import { useMongoDatabase } from "./helpers/mongo";
import { useSuiteStripe } from "./helpers/stripe";

useMongoDatabase();
useSuiteStripe();
useRegistrationWorld();

describe("extras validation on the public endpoint", () => {
  async function expectRejection(extras: JsonValue, message: string) {
    const registering = buildController().register(
      buildRegisterBody({ extras: fromAny<JsonObject, JsonValue>(extras) }),
    );

    await expect(registering).rejects.toBeInstanceOf(HTTPResult);
    await expect(registering).rejects.toMatchObject({
      status: 400,
      body: message,
    });
    expect(await world.users()).toEqual([]);
    expect(await world.tenants()).toEqual([]);
  }

  it("refuses a payload that is not a plain object", async () => {
    await expectRejection(
      ["referral", "podcast"],
      "saas.errors.registration.extras_invalid",
    );
  });

  it("refuses a payload past the size limit", async () => {
    await expectRejection(
      { bio: "x".repeat(5000) },
      "saas.errors.registration.extras_too_large",
    );
  });

  it("refuses a payload with too many keys", async () => {
    const many = Object.fromEntries(
      Array.from({ length: 65 }, (_, index) => [`k${index}`, 1]),
    );

    await expectRejection(many, "saas.errors.registration.extras_too_complex");
  });

  it("refuses a payload nested deeper than a form ever is", async () => {
    await expectRejection(
      { a: { b: { c: { d: { e: 1 } } } } },
      "saas.errors.registration.extras_too_complex",
    );
  });

  it("refuses a payload reaching for the object prototype", async () => {
    await expectRejection(
      { profile: Object.fromEntries([["__proto__", { admin: true }]]) },
      "saas.errors.registration.extras_invalid",
    );
  });
});
