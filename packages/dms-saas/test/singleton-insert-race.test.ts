import { fromPartial } from "@total-typescript/shoehorn";
import { describe, expect, it } from "vitest";
import type { BillingSettingsModel, LegalDocumentsModel } from "../src/db";
import {
  ensureBillingSettingsRow,
  ensureLegalDocumentsRow,
} from "../src/operator-billing";

interface StubbedModel {
  get: () => Promise<object | undefined>;
  insert: () => Promise<never>;
}

const SINGLETONS = [
  {
    name: "billing settings",
    ensure: (model: StubbedModel) =>
      ensureBillingSettingsRow(fromPartial<BillingSettingsModel>(model)),
  },
  {
    name: "legal documents",
    ensure: (model: StubbedModel) =>
      ensureLegalDocumentsRow(fromPartial<LegalDocumentsModel>(model)),
  },
];

describe.each(SINGLETONS)("creating the $name row", ({ ensure }) => {
  it("carries on when another replica inserted it first", async () => {
    const reads: (object | undefined)[] = [undefined, {}];
    const model = {
      get: async () => reads.shift(),
      insert: async () => {
        throw new Error("Duplicate key");
      },
    };

    await expect(ensure(model)).resolves.toBeUndefined();
  });

  it("reports an insert that failed for another reason", async () => {
    const model = {
      get: async () => undefined,
      insert: async () => {
        throw new Error("storage failed");
      },
    };

    await expect(ensure(model)).rejects.toThrow("storage failed");
  });
});
