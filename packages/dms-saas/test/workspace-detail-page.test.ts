import { describe, expect, it } from "vitest";
import { SaasWorkspaceDetailController } from "../src/pages/platform/workspaces/detail";

interface SerializedBlock {
  componentName?: string;
  options?: Record<string, unknown>;
  children: { id: string; component: SerializedBlock }[];
}

function findChild(
  block: SerializedBlock,
  id: string,
): SerializedBlock | undefined {
  for (const child of block.children) {
    if (child.id === id) return child.component;
    const nested = findChild(child.component, id);
    if (nested) return nested;
  }
  return undefined;
}

describe("workspace detail page", () => {
  const body =
    SaasWorkspaceDetailController.body.serializeSync() as SerializedBlock;

  it("underlines its tabs rather than drawing them as segments", () => {
    expect(findChild(body, "main")?.options).toMatchObject({
      variant: "link",
    });
  });

  it("reads the overview's activity as a flat feed, the tab's by day", () => {
    expect(findChild(body, "recentActivity")?.options).toMatchObject({
      groupByDay: false,
      fetchUrl: expect.stringContaining("flat=true"),
    });
    expect(findChild(body, "activity")?.options?.fetchUrl).not.toContain(
      "flat=true",
    );
  });
});
