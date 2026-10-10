import { GetDataControllerMeta } from "@antelopejs/interface-data-api";
import type {
  Component,
  ComponentInfo,
} from "@antelopejs/interface-dms/component";
import { TableViewRoutes } from "@antelopejs/interface-dms/base";
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

function* components(root: Component): Generator<Component> {
  yield root;
  const info = root.componentInfo as ComponentInfo;
  for (const child of info.children ?? []) yield* components(child.component);
}

function customComponents(root: Component): Component[] {
  return [...components(root)].filter((component) =>
    CUSTOM_COMPONENT.test(
      (component.componentInfo as ComponentInfo).componentName,
    ),
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

  it("asks the server to word promotions and demotions", async () => {
    const { options } = await SaasUsersListController.table.serialize();

    expect(
      options?.rowActions?.custom?.map((action) => action.confirm),
    ).toEqual([
      { from: "/api/saas/platform-owners/{_id}/promote-confirm" },
      { from: "/api/saas/platform-owners/{_id}/demote-confirm" },
    ]);
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
      const custom = customComponents(root as Component);

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
      options?.rowActions?.custom?.map((action) => action.target.url),
    ).toEqual([
      "/api/saas/segments/{_id}/owners-export/start",
      "/api/saas/segments/{_id}/evaluate",
      "/api/saas/segments/{_id}/duplicate",
    ]);
  });
});
