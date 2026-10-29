import { HTTPResult } from "@antelopejs/interface-api";
import { GetModel } from "@antelopejs/interface-database-decorators";
import { beforeEach, describe, expect, it } from "vitest";
import { type Plan, PlanModel } from "../src/db";
import { SaasFeaturesController } from "../src/pages/platform/features";
import { SaasPlansController } from "../src/pages/platform/plans";
import { SaasPlanMigrationsController } from "../src/pages/platform/plans/migrations";
import {
  assertFeaturesUnused,
  assertValueTypeKept,
} from "../src/plans/feature-guards";
import { useMongoDatabase } from "./helpers/mongo";

useMongoDatabase("plan-catalogue-pages");

/** Replaces the plan catalogue with `plans`, none of them deleted. */
async function publishCatalogue(plans: Partial<Plan>[]): Promise<void> {
  await GetModel(PlanModel).table.delete().run();
  if (plans.length === 0) return;
  await GetModel(PlanModel).insert(
    plans.map((plan) => ({ isDeleted: false, ...plan })),
  );
}

interface SerializedTab {
  id: string;
  filter?: { accessorKey: string; value?: string; mode: string };
  navBadge?: boolean;
}

interface SerializedAction {
  id?: string;
  label: string;
  rule?: unknown;
  confirm?: unknown;
  target: { type: string; component?: { componentName?: string } };
}

interface SerializedCardComponent {
  componentName?: string;
  options?: { selectable?: boolean };
}

interface CardsDisplayOptions {
  card?: { component?: SerializedCardComponent; skeletonHeight?: string };
}

/** The card component the plans' cards display draws, as serialized. */
async function planCard(): Promise<SerializedCardComponent> {
  const { options } = await SaasPlansController.table.serialize();
  const cards = options?.displays?.find((display) => display.id === "cards");
  return (
    (cards?.options as CardsDisplayOptions | undefined)?.card?.component ?? {}
  );
}

beforeEach(async () => {
  await publishCatalogue([]);
});

describe("the plans page", () => {
  it("opens on the stock cards, beside the grid", async () => {
    const { options } = await SaasPlansController.table.serialize();
    const card = await planCard();

    expect(options?.displays?.map((display) => display.id)).toEqual([
      "table",
      "cards",
    ]);
    expect(options?.displays?.[1]?.component).toBeUndefined();
    expect(options?.defaultDisplay).toBe("cards");
    expect(card.componentName).toBe("DmsSaasPlanCard");
    expect(card.options?.selectable).toBe(options?.rowActions?.hasSelection);
  });

  // The placeholder grid draws a page of cards as tall as a plan card, so the
  // footer stands where the loaded catalogue puts it.
  it("sizes the loading cards like a page of plan cards", async () => {
    const { options } = await SaasPlansController.table.serialize();
    const cards = options?.displays?.find((display) => display.id === "cards");

    expect(options?.pageSize).toBe(8);
    expect(
      (cards?.options as CardsDisplayOptions | undefined)?.card?.skeletonHeight,
    ).toBe("580px");
  });

  it("names each menu entry, so the cards find the one a control stands for", async () => {
    const { options } = await SaasPlansController.table.serialize();
    const actions = (options?.rowActions?.custom ?? []) as SerializedAction[];

    expect(actions.map((action) => action.id)).toEqual([
      "duplicate",
      "view_workspaces",
      "open_stripe",
      "stop_selling",
      "put_on_sale",
      "retire",
      "delete",
    ]);
    expect(
      actions.find((action) => action.id === "retire")?.target.component
        ?.componentName,
    ).toBe("DmsSaasRetirePlanModal");
  });

  // Moving cards by hand is off while a filter narrows the rows: deleted
  // plans are scoped out by the data API instead of a default filter.
  it("narrows nothing by default, so the plans move by hand", async () => {
    const { options } = await SaasPlansController.table.serialize();

    expect(options?.defaultFilters ?? []).toEqual([]);
  });

  it("asks before stopping a sale or deleting, and deletes only unused plans", async () => {
    const { options } = await SaasPlansController.table.serialize();
    const custom = options?.rowActions?.custom as SerializedAction[];
    const byLabel = (suffix: string) =>
      custom.find((action) => action.label.endsWith(suffix));

    expect(byLabel("stop_selling")?.confirm).toEqual({
      from: "/api/saas/plan-dialogs/{{row._id}}/stop-selling",
    });
    expect(byLabel("delete")).toMatchObject({
      confirm: { from: "/api/saas/plan-dialogs/{{row._id}}/delete" },
      rule: { field: "boundWorkspaceCount", equals: 0 },
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

describe("stock Duplicate", () => {
  // Plans have their own "Duplicate as new plan"; a migration is a record of
  // what happened, nothing to copy.
  it("is off on the plans and plan migrations tables", async () => {
    const plans = await SaasPlansController.table.serialize();
    const migrations = await SaasPlanMigrationsController.table.serialize();

    expect(plans.options?.rowActions?.duplicate).toBe(false);
    expect(migrations.options?.rowActions?.duplicate).toBe(false);
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
      confirm: { from: "/api/saas/plan-dialogs/features/{{row._id}}/delete" },
    });
  });
});

describe("feature guards", () => {
  const storage = { featureId: "storage", value: 100 };

  it("locks the value type while a plan stores a value", async () => {
    await publishCatalogue([{ _id: "pro", features: [storage] }]);
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
    await publishCatalogue([{ _id: "pro", features: [] }]);
    await expect(
      assertValueTypeKept(
        "storage",
        { valueType: "boolean" },
        { valueType: "number" },
      ),
    ).resolves.toBeUndefined();
  });

  it("refuses to delete a feature a plan stores", async () => {
    await publishCatalogue([{ _id: "pro", features: [storage] }]);
    await expect(assertFeaturesUnused(["storage"])).rejects.toBeInstanceOf(
      HTTPResult,
    );
    await expect(assertFeaturesUnused(["domains"])).resolves.toBeUndefined();
  });
});
