import { describe, expect, it } from "vitest";
import {
  FEATURE_FALLBACK_LOCALE,
  FEATURE_LOCALIZED_FIELDS,
  type FeatureInAllLocales,
  FeatureModel,
  PLAN_FALLBACK_LOCALE,
  PLAN_LOCALIZED_FIELDS,
  type PlanInAllLocales,
  PlanModel,
} from "@antelopejs/interface-dms-saas/db";
import {
  localizeFeature,
  localizePlan,
} from "@antelopejs/interface-dms-saas/plans";

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

describe("writing every locale through the all-locales view", () => {
  it("stores the wording a module assigns to a feature", () => {
    const texts: FeatureInAllLocales = FeatureModel.fromPlainData({
      _id: "cloud.plan.members",
    }).localize("*", FEATURE_LOCALIZED_FIELDS);
    texts.displayName = TEXTS.displayName;
    texts.description = TEXTS.description;
    texts.tooltip = TEXTS.tooltip;
    texts.unit = TEXTS.unit;
    const stored = FeatureModel.fromDatabase(
      FeatureModel.toDatabase(texts.localize(FEATURE_FALLBACK_LOCALE)),
    )!;
    expect(stored.localize("*", FEATURE_LOCALIZED_FIELDS)).toMatchObject(TEXTS);
    expect(localizeFeature(stored, "fr").displayName).toBe("Membres");
  });

  it("stores the wording a module assigns to a plan", () => {
    const wording = {
      name: { en: "Team", fr: "Équipe" },
      description: { en: "For teams", fr: "Pour les équipes" },
      borderLabel: { en: "Popular", fr: "Populaire" },
    };
    const texts: PlanInAllLocales = PlanModel.fromPlainData({
      _id: "team",
    }).localize("*", PLAN_LOCALIZED_FIELDS);
    texts.name = wording.name;
    texts.description = wording.description;
    texts.borderLabel = wording.borderLabel;
    const stored = PlanModel.fromDatabase(
      PlanModel.toDatabase(texts.localize(PLAN_FALLBACK_LOCALE)),
    )!;
    expect(stored.localize("*", PLAN_LOCALIZED_FIELDS)).toMatchObject(wording);
    expect(localizePlan(stored, "fr").description).toBe("Pour les équipes");
  });
});
