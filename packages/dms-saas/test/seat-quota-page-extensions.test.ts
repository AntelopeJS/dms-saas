import { internal } from "@antelopejs/interface-dms/page";
import { describe, expect, it, vi } from "vitest";

interface ExtensionInfo {
  extensionName: string;
  targetFullId: string;
  components: { key: string; side: string; anchorPath: string[] }[];
}

describe("seat quota page extensions", () => {
  it("puts the seat quota under the table of both workspace member pages", async () => {
    const register = vi
      .spyOn(internal.RegisterPageExtension, "register")
      .mockImplementation(() => undefined);

    await import("../src/pages/tenant/members-seat-quota");

    const infos = register.mock.calls.map(([info]) => info as ExtensionInfo);
    expect(
      infos.map(({ targetFullId, components }) => ({
        targetFullId,
        components: components.map(({ key, side, anchorPath }) => ({
          key,
          side,
          anchorPath,
        })),
      })),
    ).toEqual(
      ["settings.workspace.members", "settings.workspace.invites"].map(
        (targetFullId) => ({
          targetFullId,
          components: [
            { key: "seatQuota", side: "after", anchorPath: ["table"] },
          ],
        }),
      ),
    );
  });
});
