import { GetMetadata } from "@antelopejs/interface-core";
import { GetDataControllerMeta } from "@antelopejs/interface-data-api";
import type { Component } from "@antelopejs/interface-dms/component";
import { TableViewMeta, TableViewRoutes } from "@antelopejs/interface-dms/base";
import { describe, expect, it } from "vitest";
import { saasUsersDataAPI } from "../src/data-api/platformOwner/users";
import { SaasSegmentsController } from "../src/pages/platform/segments";
import {
  SaasSegmentEditController,
  SaasSegmentNewController,
} from "../src/pages/platform/segments/edit";
import { SaasUsersListController } from "../src/pages/platform/users";
import { SaasUserDetailController } from "../src/pages/platform/users/detail";

const CUSTOM_COMPONENT = /^DmsSaas/;
const PERMISSION_KEY = /^\$saas\.permissions\.users\.[a-z_]+$/;

/** A component's info, which the pages' builders hold at once rather than as a promise. */
function syncInfo(component: Component) {
  const info = component.componentInfo;
  if (info instanceof Promise) throw new Error("Expected a built component");
  return info;
}

function* components(root: Component): Generator<Component> {
  yield root;
  for (const child of syncInfo(root).children ?? [])
    yield* components(child.component);
}

function customComponents(root: Component): Component[] {
  return [...components(root)].filter((component) =>
    CUSTOM_COMPONENT.test(syncInfo(component).componentName),
  );
}

describe("users list", () => {
  it("counts its tabs with the batch count route", async () => {
    const meta = GetDataControllerMeta(new saasUsersDataAPI());
    const { options } = await SaasUsersListController.table.serialize();

    expect(meta.endpoints.countBatch?.callback).toBe(
      TableViewRoutes.CountBatch.callback,
    );
    expect(
      options?.tabs?.map((tab) => [tab.id, tab.filter?.accessorKey]),
    ).toEqual([
      ["all", undefined],
      ["platform_admins", "owner"],
      ["unverified", "isValidated"],
    ]);
  });

  it("offers no way to copy an account", async () => {
    const { options } = await SaasUsersListController.table.serialize();

    expect(options?.rowActions?.duplicate).toBe(false);
  });

  it("asks the server to word promotions and demotions", async () => {
    const { options } = await SaasUsersListController.table.serialize();

    expect(
      options?.rowActions?.custom?.map((action) => action.confirm),
    ).toEqual([
      { from: "/api/saas/platform-owners/{{row._id}}/promote-confirm" },
      { from: "/api/saas/platform-owners/{{row._id}}/demote-confirm" },
    ]);
  });
});

describe("users list columns", () => {
  const columns = GetMetadata(saasUsersDataAPI, TableViewMeta).columns;

  it("draws the platform role as a pill on admins, filtered on the flag", () => {
    expect(columns.owner?.isVisible).toBe(false);
    expect(columns.owner?.filterable).toBe(true);
    expect(columns.platformRole?.display).toMatchObject({
      options: { exclusive: { field: "owner", icon: "i-ph-shield-check" } },
    });
  });

  it("writes the creation date with its year", () => {
    expect(columns.createdAt?.display).toBeUndefined();
  });
});

describe("pages of the area", () => {
  it.each([
    ["user detail", SaasUserDetailController.layout],
    ["new segment", SaasSegmentNewController.editor],
    ["segment editor", SaasSegmentEditController.editor],
  ])(
    "describe every custom component of the %s for the roles editor",
    (_, root) => {
      const custom = customComponents(root);

      expect(custom.length).toBeGreaterThan(0);
      for (const component of custom) {
        expect(component.metadata.name).toMatch(PERMISSION_KEY);
        expect(component.metadata.description).toBe(
          `${component.metadata.name}_description`,
        );
      }
    },
  );

  it("offers every segment action from the list", async () => {
    const { options } = await SaasSegmentsController.table.serialize();

    expect(
      options?.rowActions?.custom?.map(({ target }) =>
        "url" in target ? target.url : undefined,
      ),
    ).toEqual([
      "/api/saas/segments/{{row._id}}/owners-export/start",
      "/api/saas/segments/{{row._id}}/evaluate",
      "/api/saas/segments/{{row._id}}/duplicate",
    ]);
  });
});
