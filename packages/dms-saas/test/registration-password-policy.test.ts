import { fromPartial } from "@total-typescript/shoehorn";
import { describe, expect, it, vi } from "vitest";
import { getStripeClient } from "../src/stripe/client";
import {
  buildController,
  buildRegisterBody,
  useRegistrationWorld,
  world,
} from "./helpers/registration";
import { useMongoDatabase } from "./helpers/mongo";
import { useSuiteStripe } from "./helpers/stripe";

useMongoDatabase("registration-password-policy");
useSuiteStripe();
const stripe = useRegistrationWorld();

describe("password policy on the public endpoint", () => {
  it.each([
    ["too short", "Ab1!"],
    ["without an uppercase letter", "correct horse 9!"],
    ["without a number", "CorrectHorse!"],
    ["without a special character", "CorrectHorse9"],
    ["with a special character outside the allowed set", "CorrectHorse9#"],
  ])(
    "refuses a password %s before anything exists",
    async (_case, password) => {
      const controller = buildController();
      const lookup = vi.spyOn(controller.userModel, "getByEmail");
      const retrieve = vi.spyOn(getStripeClient().paymentMethods, "retrieve");

      await expect(
        controller.register({ ...buildRegisterBody(), password }),
      ).rejects.toMatchObject({
        status: 400,
        body: "saas.errors.registration.password_policy",
      });
      expect(lookup).not.toHaveBeenCalled();
      expect(retrieve).not.toHaveBeenCalled();
      expect(await world.users()).toEqual([]);
      expect(stripe.customers.size).toBe(0);
    },
  );

  it("refuses a registration that sends no password", async () => {
    const { password: _password, ...body } = buildRegisterBody();

    await expect(
      buildController().register(fromPartial(body)),
    ).rejects.toMatchObject({
      status: 400,
      body: "saas.errors.registration.password_policy",
    });
    expect(await world.users()).toEqual([]);
  });

  it("registers an account whose password meets the policy", async () => {
    const result = await buildController().register(buildRegisterBody());

    expect((await world.users()).map((user) => user._id)).toContain(
      result.userId,
    );
  });
});
