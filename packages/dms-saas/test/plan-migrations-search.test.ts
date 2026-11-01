import { GetMetadata } from "@antelopejs/interface-core";
import { GetDataControllerMeta } from "@antelopejs/interface-data-api";
import { SearchableMeta } from "@antelopejs/interface-dms/base";
import { describe, expect, it } from "vitest";
import { planMigrationsDataAPI } from "../src/data-api/platformOwner/plan-migrations";

describe("plan migrations search", () => {
  it("matches the plan names a migration moves from and to", () => {
    const meta = GetDataControllerMeta(new planMigrationsDataAPI());
    const searchable = GetMetadata(planMigrationsDataAPI, SearchableMeta);

    for (const field of ["fromPlanName", "toPlanName"]) {
      expect(JSON.stringify(searchable)).toContain(field);
      expect(meta.filters[field]).toBeTypeOf("function");
    }
  });
});
