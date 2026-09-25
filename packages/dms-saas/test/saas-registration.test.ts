import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  firstMissingRegistrationRequirement,
  isPaymentStepShown,
  isRegistrationClosedBy,
  type RegistrationRequirements,
  resolveRegistrationPaymentPolicy,
  snapshotRegistrationExtras,
} from "../frontend-vue/app/composables/useSaasRegistration";

type LocaleTree = Record<string, unknown>;

const MET_REQUIREMENTS: RegistrationRequirements = {
  isPaymentRequired: true,
  isPaymentReady: true,
  hasAcceptedLegal: true,
};

function readLocale(file: string): LocaleTree {
  const url = new URL(`../frontend-vue/i18n/locales/${file}`, import.meta.url);
  return JSON.parse(readFileSync(url, "utf-8")) as LocaleTree;
}

function lookup(tree: LocaleTree, key: string): unknown {
  return key
    .split(".")
    .reduce<unknown>(
      (node, segment) => (node as LocaleTree | undefined)?.[segment],
      tree,
    );
}

describe("firstMissingRegistrationRequirement", () => {
  it("clears a form that meets every requirement", () => {
    expect(firstMissingRegistrationRequirement(MET_REQUIREMENTS)).toBeNull();
  });

  it("reports the card before the legal acceptance", () => {
    const requirements: RegistrationRequirements = {
      isPaymentRequired: true,
      isPaymentReady: false,
      hasAcceptedLegal: false,
    };

    expect(firstMissingRegistrationRequirement(requirements)).toBe(
      "saas.register.error.no_payment",
    );
  });

  it("asks for no card when none is collected", () => {
    const requirements = {
      ...MET_REQUIREMENTS,
      isPaymentRequired: false,
      isPaymentReady: false,
    };

    expect(firstMissingRegistrationRequirement(requirements)).toBeNull();
  });

  it("always requires the legal acceptance", () => {
    const requirements = {
      isPaymentRequired: false,
      isPaymentReady: false,
      hasAcceptedLegal: false,
    };

    expect(firstMissingRegistrationRequirement(requirements)).toBe(
      "saas.register.error.legal_required",
    );
  });
});

describe("resolveRegistrationPaymentPolicy", () => {
  it("follows the policy the deployment published", () => {
    expect(
      resolveRegistrationPaymentPolicy({ registrationPaymentMethod: "none" }),
    ).toBe("none");
    expect(
      resolveRegistrationPaymentPolicy({
        registrationPaymentMethod: "optional",
      }),
    ).toBe("optional");
  });

  it("falls back to requiring a card, like the backend", () => {
    expect(resolveRegistrationPaymentPolicy(undefined)).toBe("required");
    expect(resolveRegistrationPaymentPolicy({})).toBe("required");
    expect(
      resolveRegistrationPaymentPolicy({
        registrationPaymentMethod: "sometimes" as never,
      }),
    ).toBe("required");
  });
});

describe("isPaymentStepShown", () => {
  it("always shows the card step under `required`", () => {
    expect(isPaymentStepShown("required", false)).toBe(true);
    expect(isPaymentStepShown("required", true)).toBe(true);
  });

  it("lets the visitor skip it under `optional`", () => {
    expect(isPaymentStepShown("optional", false)).toBe(true);
    expect(isPaymentStepShown("optional", true)).toBe(false);
  });

  it("never shows it under `none`", () => {
    expect(isPaymentStepShown("none", false)).toBe(false);
  });
});

describe("isRegistrationClosedBy", () => {
  it("closes the form when admission is by invitation only", () => {
    expect(isRegistrationClosedBy({ admissionMode: "invitation-only" })).toBe(
      true,
    );
  });

  it("keeps it open otherwise", () => {
    expect(isRegistrationClosedBy({ admissionMode: "open" })).toBe(false);
    expect(isRegistrationClosedBy(undefined)).toBe(false);
  });
});

describe("snapshotRegistrationExtras", () => {
  it("sends nothing when the consumer captured nothing", () => {
    expect(snapshotRegistrationExtras(undefined)).toBeUndefined();
    expect(snapshotRegistrationExtras({})).toBeUndefined();
  });

  it("detaches the capture from the object the consumer keeps editing", () => {
    const live = { referral: "podcast", profile: { size: "5" } };

    const captured = snapshotRegistrationExtras(live);
    live.referral = "changed after submit";
    live.profile.size = "500";

    expect(captured).toEqual({ referral: "podcast", profile: { size: "5" } });
  });
});

describe("registration copy", () => {
  it.each(["saas-en-GB.json", "saas-fr-FR.json"])(
    "names the default workspace after its owner in %s",
    (file) => {
      const pattern = lookup(
        readLocale(file),
        "saas.register.default_workspace_name",
      );

      expect(pattern).toEqual(expect.stringContaining("{name}"));
    },
  );

  it.each(["saas-en-GB.json", "saas-fr-FR.json"])(
    "states the password rule in %s",
    (file) => {
      expect(lookup(readLocale(file), "saas.register.hint.password")).toEqual(
        expect.any(String),
      );
    },
  );
});
