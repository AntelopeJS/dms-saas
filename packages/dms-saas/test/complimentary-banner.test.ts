import { describe, expect, it } from "vitest";
import type { TenantSubscription } from "../src/db";
import {
  CHOOSE_PLAN_ANCHOR,
  type ComplimentaryBannerInputs,
  complimentaryBanner,
} from "../src/workspaces/complimentary-banner";
import { LOCALES, missingKeys, writeText } from "./helpers/composed-text";

const NOW = new Date("2026-10-01T12:00:00.000Z");
const ENDS_AT = new Date("2026-10-04T00:00:00.000Z");

function subscription(
  overrides: Partial<TenantSubscription> = {},
): TenantSubscription {
  return {
    _id: "sub-1",
    tenantId: "tenant-1",
    planId: "pro",
    status: "active",
    isComplimentary: true,
    freeUntil: null,
    ...overrides,
  } as TenantSubscription;
}

function inputs(
  overrides: Partial<ComplimentaryBannerInputs> = {},
): ComplimentaryBannerInputs {
  return {
    subscription: subscription(),
    workspaceName: "Acme",
    planName: "Pro",
    isTenantOwner: true,
    now: NOW,
    ...overrides,
  };
}

describe("complimentary access banner", () => {
  it("shows nothing to a workspace that pays", () => {
    expect(
      complimentaryBanner(
        inputs({ subscription: subscription({ isComplimentary: false }) }),
      ),
    ).toBeNull();
    expect(complimentaryBanner(inputs({ subscription: null }))).toBeNull();
  });

  it("announces an open-ended gift without offering a plan", () => {
    const banner = complimentaryBanner(inputs())!;

    expect(banner).toMatchObject({ tone: "info", icon: "i-ph-gift" });
    expect(banner.actions).toEqual([]);
    expect(writeText(banner.description)).toBe(
      "Acme is on a complimentary Pro plan with no end date. Nothing is charged.",
    );
  });

  it("counts the days left of an ending gift and lets the owner choose a plan", () => {
    const banner = complimentaryBanner(
      inputs({ subscription: subscription({ freeUntil: ENDS_AT }) }),
    )!;

    expect(banner.tone).toBe("warning");
    expect(writeText(banner.title)).toBe("Complimentary access ends 4 Oct");
    expect(writeText(banner.description)).toMatch(/^3 days left\./);
    expect(banner.actions).toEqual([
      expect.objectContaining({ to: CHOOSE_PLAN_ANCHOR, icon: "i-ph-stack" }),
    ]);
  });

  it("offers a member no plan to choose", () => {
    const banner = complimentaryBanner(
      inputs({
        subscription: subscription({ freeUntil: ENDS_AT }),
        isTenantOwner: false,
      }),
    )!;

    expect(banner.actions).toEqual([]);
  });

  it("turns to an error once the expired gift blocks the workspace", () => {
    const banner = complimentaryBanner(
      inputs({
        subscription: subscription({ status: "suspended", freeUntil: ENDS_AT }),
      }),
    )!;

    expect(banner.tone).toBe("error");
    expect(writeText(banner.title)).toBe("Complimentary access expired 4 Oct");
  });

  it.each(LOCALES)("%s has every key the banner names", (code) => {
    const states = [
      subscription(),
      subscription({ freeUntil: ENDS_AT }),
      subscription({ status: "suspended", freeUntil: ENDS_AT }),
      subscription({ status: "suspended" }),
    ];
    const banners = states.map((state) =>
      complimentaryBanner(inputs({ subscription: state })),
    );

    expect(missingKeys(banners, code)).toEqual([]);
  });
});
