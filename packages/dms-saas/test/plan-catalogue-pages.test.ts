import { HTTPResult } from "@antelopejs/interface-api";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SaasFeaturesController } from "../src/pages/platform/features";
import { SaasPlansController } from "../src/pages/platform/plans";
import { SaasPlanMigrationsController } from "../src/pages/platform/plans/migrations";
import {
  assertFeaturesUnused,
  assertValueTypeKept,
} from "../src/plans/feature-guards";

const catalogue = vi.hoisted(() => ({ plans: [] as unknown[] }));

vi.mock("@antelopejs/interface-database-decorators", async (original) => ({
  ...(await original<object>()),
  GetModel: () => ({ findNotDeleted: async () => catalogue.plans }),
}));

interface SerializedTab {
  id: string;
  filter?: { accessorKey: string; value?: string; mode: string };
  navBadge?: boolean;
}

interface SerializedAction {
  key?: string;
  label: string;
  rule?: unknown;
  confirm?: unknown;
  target: { type: string; component?: { componentName?: string } };
}

beforeEach(() => {
  catalogue.plans = [];
});

describe("the plans page", () => {
  it("opens on the cards, with the plan menu the grid uses", async () => {
    const { options } = await SaasPlansController.table.serialize();
    const displayOptions = options?.displays?.[0]?.options ?? {};
    const actions =
      (displayOptions as { actions?: SerializedAction[] }).actions ?? [];

    expect(options?.defaultDisplay).toBe("saas:plan-cards");
    expect(actions.map((action) => action.key)).toEqual([
      "duplicate",
      "view_workspaces",
      "open_stripe",
      "stop_selling",
      "put_on_sale",
      "retire",
      "delete",
    ]);
    expect(
      actions.find((action) => action.key === "retire")?.target.component
        ?.componentName,
    ).toBe("DmsSaasRetirePlanModal");
    expect(options?.rowActions?.custom?.map((action) => action.label)).toEqual(
      actions.map((action) => action.label),
    );
  });

  it("asks before stopping a sale or deleting, and deletes only unused plans", async () => {
    const { options } = await SaasPlansController.table.serialize();
    const custom = options?.rowActions?.custom as SerializedAction[];
    const byLabel = (suffix: string) =>
      custom.find((action) => action.label.endsWith(suffix));

    expect(byLabel("stop_selling")?.confirm).toEqual({
      from: "/api/saas/plan-dialogs/{_id}/stop-selling",
    });
    expect(byLabel("delete")).toMatchObject({
      confirm: { from: "/api/saas/plan-dialogs/{_id}/delete" },
      rule: { field: "workspaceCount", equals: 0 },
    });
  });

  it("splits the plans on sale from the legacy ones and reorders by hand", async () => {
    const { options } = await SaasPlansController.table.serialize();
    const tabs = options?.tabs as SerializedTab[];

    expect(tabs.map((tab) => tab.id)).toEqual(["on_sale", "legacy", "all"]);
    expect(tabs[1]?.filter).toEqual({
      accessorKey: "isActive",
      value: "false",
      mode: "is",
    });
    expect(options?.reorder).toEqual({ field: "order" });
  });
});

describe("the plan migrations page", () => {
  it("is listed in the catalogue with a tab per stage, badging the ones needing attention", async () => {
    const { options } = await SaasPlanMigrationsController.table.serialize();
    const tabs = options?.tabs as SerializedTab[];

    expect(tabs.map((tab) => tab.id)).toEqual([
      "all",
      "running",
      "needs_attention",
      "completed",
    ]);
    expect(tabs.find((tab) => tab.navBadge)?.id).toBe("needs_attention");
    expect(tabs[3]?.filter?.value).toBe("done");
  });
});

describe("the features page", () => {
  it("edits in a drawer, ordered by hand, deleting through the guarded dialog", async () => {
    const { options } = await SaasFeaturesController.table.serialize();

    expect(options?.formContainer?.type).toBe("drawer");
    expect(options?.reorder).toEqual({ field: "order" });
    expect(options?.rowActions?.delete).toMatchObject({
      confirm: { from: "/api/saas/plan-dialogs/features/{_id}/delete" },
    });
  });
});

describe("feature guards", () => {
  const storage = { featureId: "storage", value: 100 };

  it("locks the value type while a plan stores a value", async () => {
    catalogue.plans = [{ _id: "pro", features: [storage] }];
    const error = await assertValueTypeKept(
      "storage",
      { valueType: "boolean" },
      { valueType: "number" },
    ).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(HTTPResult);
    expect(
      JSON.parse(String((error as HTTPResult).getBody())) as unknown,
    ).toMatchObject({ field: "valueType" });
  });

  it("lets the value type change while no plan stores a value", async () => {
    catalogue.plans = [{ _id: "pro", features: [] }];
    await expect(
      assertValueTypeKept(
        "storage",
        { valueType: "boolean" },
        { valueType: "number" },
      ),
    ).resolves.toBeUndefined();
  });

  it("refuses to delete a feature a plan stores", async () => {
    catalogue.plans = [{ _id: "pro", features: [storage] }];
    await expect(assertFeaturesUnused(["storage"])).rejects.toBeInstanceOf(
      HTTPResult,
    );
    await expect(assertFeaturesUnused(["domains"])).resolves.toBeUndefined();
  });
});
