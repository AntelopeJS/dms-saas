import { describe, expect, it, vi } from "vitest";
import {
  registerPublicScreens,
  resolvePublicScreensToRegister,
} from "../src/pages/public/screens";
import type { DmsSaasConfig } from "../src/types";

const { evaluateRegisterPage, evaluatePricingPage } = vi.hoisted(() => ({
  evaluateRegisterPage: vi.fn(),
  evaluatePricingPage: vi.fn(),
}));

vi.mock("../src/pages/public/register", () => {
  evaluateRegisterPage();
  return {};
});

vi.mock("../src/pages/public/pricing", () => {
  evaluatePricingPage();
  return {};
});

const ALL_SCREENS = ["register", "pricing"];

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
  it("serves every bundled screen when nothing is configured", () => {
    expect(resolvePublicScreensToRegister(configWith())).toEqual(ALL_SCREENS);
  });

  it("serves them when the consumer left an empty screen map", () => {
    expect(resolvePublicScreensToRegister(configWith({}))).toEqual(ALL_SCREENS);
  });

  it("frees the register slug when the consumer opts out", () => {
    expect(
      resolvePublicScreensToRegister(configWith({ register: false })),
    ).toEqual(["pricing"]);
  });

  it("frees the pricing slug when the consumer opts out", () => {
    expect(
      resolvePublicScreensToRegister(configWith({ pricing: false })),
    ).toEqual(["register"]);
  });

  it("keeps serving them on an explicit opt-in", () => {
    expect(
      resolvePublicScreensToRegister(
        configWith({ register: true, pricing: true }),
      ),
    ).toEqual(ALL_SCREENS);
  });
});

describe("registerPublicScreens", () => {
  it("evaluates the page module only for the screens it serves", async () => {
    await registerPublicScreens(
      configWith({ register: false, pricing: false }),
    );

    // The page registers itself on import, so opting out has to keep the
    // module from ever being evaluated — not merely skip a registration call.
    expect(evaluateRegisterPage).not.toHaveBeenCalled();
    expect(evaluatePricingPage).not.toHaveBeenCalled();

    await registerPublicScreens(configWith());

    expect(evaluateRegisterPage).toHaveBeenCalledTimes(1);
    expect(evaluatePricingPage).toHaveBeenCalledTimes(1);
  });
});
