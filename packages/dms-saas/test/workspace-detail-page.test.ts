import { assert, describe, expect, it } from "vitest";
import { SaasWorkspaceDetailController } from "../src/pages/platform/workspaces/detail";
import { findChild, isOptionRecord } from "./helpers/serialized";

describe("workspace detail page", () => {
  const body = SaasWorkspaceDetailController.body.serializeSync();

  it("underlines its tabs rather than drawing them as segments", () => {
    expect(findChild(body, "main")?.options).toMatchObject({
      variant: "link",
    });
  });

  it("reads the overview's activity as a flat feed, the tab's by day", () => {
    const flatFeed: unknown = expect.stringContaining("flat=true");
    expect(findChild(body, "recentActivity")?.options).toMatchObject({
      groupByDay: false,
      fetchUrl: flatFeed,
    });
    const activity = findChild(body, "activity")?.options;
    assert(isOptionRecord(activity));
    expect(activity.fetchUrl).not.toContain("flat=true");
  });

  it.each(["table", "invoiceTable", "creditNoteTable"])(
    "hides the workspace column of %s rather than offering a view for it",
    (id) => {
      const options = findChild(body, id)?.options;
      assert(isOptionRecord(options));
      assert(Array.isArray(options.columns));
      expect(
        options.columns.find(
          (column) => isOptionRecord(column) && column.id === "workspaceName",
        ),
      ).toMatchObject({ isVisible: false });
      expect(options.views).toBeUndefined();
    },
  );
});
