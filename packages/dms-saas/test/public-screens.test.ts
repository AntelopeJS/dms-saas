import { describe, expect, it, vi } from "vitest";
import {
  registerPublicScreens,
  resolvePublicScreensToRegister,
} from "../src/pages/public/screens";
import type { DmsSaasConfig } from "../src/types";

const { evaluateRegisterPage } = vi.hoisted(() => ({
  evaluateRegisterPage: vi.fn(),
}));

vi.mock("../src/pages/public/register", () => {
  evaluateRegisterPage();
  return {};
});

const STRIPE_CONFIG = {
  secretKey: "sk_test",
  webhookSecret: "whsec_test",
  publishableKey: "pk_test",
};

function configWith(
  publicScreens?: DmsSaasConfig["publicScreens"],
): DmsSaasConfig {
  return { stripe: STRIPE_CONFIG, publicScreens };
}

describe("resolvePublicScreensToRegister", () => {
  it("serves the bundled register screen when nothing is configured", () => {
    expect(resolvePublicScreensToRegister(configWith())).toEqual(["register"]);
  });

  it("serves it when the consumer left an empty screen map", () => {
    expect(resolvePublicScreensToRegister(configWith({}))).toEqual([
      "register",
    ]);
  });

  it("frees the register slug when the consumer opts out", () => {
    expect(
      resolvePublicScreensToRegister(configWith({ register: false })),
    ).toEqual([]);
  });

  it("keeps serving it on an explicit opt-in", () => {
    expect(
      resolvePublicScreensToRegister(configWith({ register: true })),
    ).toEqual(["register"]);
  });
});

describe("registerPublicScreens", () => {
  it("evaluates the page module only for the screens it serves", async () => {
    await registerPublicScreens(configWith({ register: false }));

    // The page registers itself on import, so opting out has to keep the
    // module from ever being evaluated — not merely skip a registration call.
    expect(evaluateRegisterPage).not.toHaveBeenCalled();

    await registerPublicScreens(configWith());

    expect(evaluateRegisterPage).toHaveBeenCalledTimes(1);
  });
});
