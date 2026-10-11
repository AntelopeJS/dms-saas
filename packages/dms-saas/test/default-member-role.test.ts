import type { Role } from "@antelopejs/interface-dms/db";
import type { PermissionTree } from "@antelopejs/interface-dms/permissions";
import { beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({
  inserted: [] as { tenantId: string; role: Partial<Role> }[],
}));

function node(id: string, children: Record<string, PermissionTree> = {}) {
  return { data: { id, title: id }, children };
}

vi.mock("@antelopejs/interface-dms/permissions", () => ({
  GetPermissions: async (): Promise<Record<string, PermissionTree>> => ({
    general: node("general", {
      identity: node("general.identity"),
      dangerZone: node("general.dangerZone"),
    }),
    billing: { children: { plan: node("billing.plan") } },
  }),
}));

vi.mock(
  "@antelopejs/interface-database-decorators",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("@antelopejs/interface-database-decorators")
    >()),
    GetModel: (_model: unknown, tenantId: string) => ({
      insert: async (rows: Partial<Role>[]) => {
        harness.inserted.push(...rows.map((role) => ({ tenantId, role })));
        return rows.map((role) => role._id);
      },
    }),
  }),
);

const { createDefaultMemberRole } =
  await import("../src/workspaces/default-member-role");

beforeEach(() => {
  harness.inserted = [];
});

describe("default Member role of a new workspace", () => {
  it("grants every permission the DMS registers, in the workspace's own roles", async () => {
    const roleId = await createDefaultMemberRole("acme", "en");

    expect(roleId).toBe("acme:member");
    expect(harness.inserted).toEqual([
      {
        tenantId: "acme",
        role: expect.objectContaining({
          _id: "acme:member",
          name: "Member",
          description: "Everything the workspace plan includes",
          permissions: [
            "general",
            "general.identity",
            "general.dangerZone",
            "billing.plan",
          ],
        }),
      },
    ]);
  });

  it.each([
    ["fr", "Membre"],
    ["fr-FR", "Membre"],
    ["de", "Member"],
    [undefined, "Member"],
  ])("names the role in the owner's language %s", async (language, name) => {
    await createDefaultMemberRole("acme", language);

    expect(harness.inserted[0]?.role.name).toBe(name);
  });
});
