import { describe, expect, it } from "vitest";
import {
  registerPublicScreens,
  resolvePublicScreensToRegister,
} from "../src/pages/public/screens";
import type { DmsSaasConfig } from "../src/types";
import { implementPageRegistry, registered } from "./helpers/pages";

const registry = implementPageRegistry();

/** The public screens whose page registered itself, once per registration. */
function registeredScreens(): string[] {
  return registered(registry.pages)
    .map(({ id }) => id)
    .filter((id) => ALL_SCREENS.includes(id));
}

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

    expect(registeredScreens()).toEqual([]);

    await registerPublicScreens(configWith());

    expect(registeredScreens()).toEqual(ALL_SCREENS);
  });
});
