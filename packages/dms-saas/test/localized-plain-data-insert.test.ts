import { GetModel } from "@antelopejs/interface-database-decorators";
import { describe, expect, it } from "vitest";
import {
  FEATURE_LOCALIZED_FIELDS,
  FeatureModel,
  PLAN_LOCALIZED_FIELDS,
  PlanModel,
} from "../src/db";
import { localizeFeature, localizePlan } from "../src/plans";
import { useMongoDatabase } from "./helpers/mongo";

useMongoDatabase();

describe("inserting per-locale plain data", () => {
  it("stores every locale of a feature's texts", async () => {
    const texts = {
      displayName: { en: "Members", fr: "Membres" },
      description: { en: "People per workspace", fr: "Personnes par espace" },
      tooltip: { en: "People in the workspace" },
      unit: { en: "member | members", fr: "membre | membres" },
    };
    const model = GetModel(FeatureModel);

    await model.insert(
      FeatureModel.fromPlainData({ _id: "cloud.plan.members", ...texts }),
    );

    const stored = await model.get("cloud.plan.members");
    expect(stored?.localize("*", FEATURE_LOCALIZED_FIELDS)).toMatchObject(
      texts,
    );
    expect(localizeFeature(stored!, "fr").displayName).toBe("Membres");
  });

  it("stores every locale of a plan's texts", async () => {
    const texts = {
      name: { en: "Team", fr: "Équipe" },
      description: { en: "For teams", fr: "Pour les équipes" },
      borderLabel: { en: "Popular", fr: "Populaire" },
    };
    const model = GetModel(PlanModel);

    await model.insert(PlanModel.fromPlainData({ _id: "team", ...texts }));

    const stored = await model.get("team");
    expect(stored?.localize("*", PLAN_LOCALIZED_FIELDS)).toMatchObject(texts);
    expect(localizePlan(stored!, "fr").name).toBe("Équipe");
  });
});
