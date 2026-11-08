import { beforeEach, describe, expect, it } from "vitest";
import { CROSS_INSTANCE } from "@antelopejs/interface-database";
import { GetModel } from "@antelopejs/interface-database-decorators";
import { SegmentModel, TenantSubscriptionModel } from "../src/db";
import { subscriptionFixture } from "./helpers/subscription-fixture";
import { useMongoDatabase } from "./helpers/mongo";

useMongoDatabase();

beforeEach(async () => {
  await GetModel(TenantSubscriptionModel, CROSS_INSTANCE).table.delete().run();
  await GetModel(SegmentModel).table.delete().run();
});

function patchSetting(field: string, value: string | number) {
  return Object.fromEntries([[field, value]]);
}

async function segmentFixture() {
  const model = GetModel(SegmentModel);
  const [id] = await model.insert({
    name: "A",
    conditions: { logical: "and", conditions: [] },
    estimatedCount: 0,
    countHistory: [],
    lastEvaluationMs: null,
  });
  return { model, id };
}

describe("SegmentModel.update with validate: true", () => {
  it("rejects a wrongly typed field and keeps the stored segment", async () => {
    const { model, id } = await segmentFixture();
    await expect(
      model.update(id, patchSetting("name", 5), { validate: true }),
    ).rejects.toThrow("Invalid segment patch");
    await expect(
      model.update(
        { ...patchSetting("estimatedCount", "many"), _id: id },
        { validate: true },
      ),
    ).rejects.toThrow("Invalid segment patch");
    const stored = await model.get(id);
    expect(stored?.name).toBe("A");
    expect(stored?.estimatedCount).toBe(0);
  });

  it("applies a well-typed patch", async () => {
    const { model, id } = await segmentFixture();
    await expect(
      model.update(id, { name: "B" }, { validate: true }),
    ).resolves.toBe(1);
    expect((await model.get(id))?.name).toBe("B");
  });
});

describe("TenantSubscriptionModel.update with validate: true", () => {
  it("rejects a status outside the vocabulary and keeps the stored one", async () => {
    const { model, id } = await subscriptionFixture();
    await expect(
      model.update(id, patchSetting("status", "bogus"), { validate: true }),
    ).rejects.toThrow("Invalid subscription patch");
    await expect(
      model.update(id, patchSetting("stripeCustomerId", 7), { validate: true }),
    ).rejects.toThrow("Invalid subscription patch");
    expect((await model.get(id))?.status).toBe("active");
  });

  it("applies a well-typed patch", async () => {
    const { model, id } = await subscriptionFixture();
    await expect(
      model.update(
        id,
        { status: "suspended", stripeCustomerId: "cus_1" },
        { validate: true },
      ),
    ).resolves.toBe(1);
    const stored = await model.get(id);
    expect(stored?.status).toBe("suspended");
    expect(stored?.stripeCustomerId).toBe("cus_1");
  });
});
