import { describe, expect, it } from "vitest";
import { FeatureModel } from "@antelopejs/interface-dms-saas/db";
import { localizeFeature } from "@antelopejs/interface-dms-saas/plans";

const TEXTS = {
  displayName: { en: "Members", fr: "Membres" },
  description: { en: "People per workspace", fr: "Personnes par espace" },
  tooltip: { en: "People in the workspace" },
  unit: { en: "member | members", fr: "membre | membres" },
};

function storedFeature() {
  const written = FeatureModel.fromPlainData({
    _id: "cloud.plan.members",
    ...TEXTS,
  }).localize("*");
  return FeatureModel.fromDatabase(FeatureModel.toDatabase(written))!;
}

describe("feature localization", () => {
  it("stores one value per locale", () => {
    expect(storedFeature().localize("*")).toMatchObject(TEXTS);
  });

  it("reads the texts in the requested locale", () => {
    const feature = localizeFeature(storedFeature(), "fr");
    expect(feature).toMatchObject({
      displayName: "Membres",
      description: "Personnes par espace",
      unit: "membre | membres",
    });
  });

  it("falls back to English where the locale has no value", () => {
    const feature = localizeFeature(storedFeature(), "fr");
    expect(feature.tooltip).toBe("People in the workspace");
  });
});
