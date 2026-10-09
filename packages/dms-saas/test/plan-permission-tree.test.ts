import type { PermissionTree } from "@antelopejs/interface-dms/permissions";
import { describe, expect, it } from "vitest";
import {
  mapPlanPermissionTree,
  withPermissionAncestors,
} from "../src/plans/plan-permission-tree";
import { pickPlanWrite } from "../src/plans/plan-write";

function branch(
  id: string,
  children: Record<string, PermissionTree> = {},
  defaultGranted = false,
): PermissionTree {
  return { data: { id, title: id, defaultGranted }, children };
}

const TREE: Record<string, PermissionTree> = {
  pages: branch("pages", {
    welcome: branch("pages.welcome", {
      form: branch("pages.welcome.form"),
    }),
    auth: branch("pages.auth", { content: branch("pages.auth.content") }, true),
  }),
  settings: branch(
    "settings",
    {
      user: branch(
        "settings.user",
        {
          profile: branch(
            "settings.user.profile",
            { form: branch("settings.user.profile.form") },
            true,
          ),
        },
        true,
      ),
      workspace: branch("settings.workspace", {
        billing: branch("settings.workspace.billing", {
          planCard: branch("settings.workspace.billing.planCard"),
        }),
      }),
    },
    true,
  ),
  media: {
    children: { upload: branch("media.upload") },
  },
};

const ENTRY_IDS = new Set([
  "settings.user.profile",
  "settings.workspace",
  "settings.workspace.billing",
]);

function ids(nodes: ReturnType<typeof mapPlanPermissionTree>): unknown[] {
  return nodes.map((node) =>
    node.children ? { [node.id]: ids(node.children) } : node.id,
  );
}

describe("permission tree the plan editor offers", () => {
  it("lifts the workspace settings out of the settings root every member holds", () => {
    expect(ids(mapPlanPermissionTree(TREE, ENTRY_IDS))).toEqual([
      { pages: [{ "pages.welcome": ["pages.welcome.form"] }] },
      {
        "settings.workspace": [
          {
            "settings.workspace.billing": [
              "settings.workspace.billing.planCard",
            ],
          },
        ],
      },
      "media.upload",
    ]);
  });
});

describe("plan permissions and their ancestors", () => {
  it("completes a permission with every id it sits under", () => {
    expect(
      withPermissionAncestors(["settings.workspace.billing.planCard"]),
    ).toEqual([
      "settings.workspace.billing.planCard",
      "settings.workspace.billing",
      "settings.workspace",
      "settings",
    ]);
  });

  it("stores a plan with the ancestors of its permissions", () => {
    expect(
      pickPlanWrite({ permissions: ["pages.welcome.form", "pages"] })
        .permissions,
    ).toEqual(["pages.welcome.form", "pages.welcome", "pages"]);
  });
});
