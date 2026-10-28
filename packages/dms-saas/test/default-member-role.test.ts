import { randomUUID } from "node:crypto";
import { GetModel } from "@antelopejs/interface-database-decorators";
import { RoleModel } from "@antelopejs/interface-dms/db";
import * as permissions from "@antelopejs/interface-dms/permissions";
import { beforeAll, describe, expect, it } from "vitest";
import { createDefaultMemberRole } from "../src/workspaces/default-member-role";
import { implementWithDms } from "./helpers/dms";
import { useMongoDatabase } from "./helpers/mongo";

useMongoDatabase("default-member-role");

beforeAll(() => {
  implementWithDms(permissions, "implementations/dms/permissions.js");
  for (const id of [
    "general",
    "general.identity",
    "general.dangerZone",
    "billing.plan",
  ]) {
    permissions.RegisterPermission(id, { id, title: id });
  }
});

describe("default Member role of a new workspace", () => {
  it("grants every permission the DMS registers, in the workspace's own roles", async () => {
    const tenantId = randomUUID();

    const roleId = await createDefaultMemberRole(tenantId, "en");

    expect(roleId).toBe(`${tenantId}:member`);
    await expect(GetModel(RoleModel, tenantId).getAll()).resolves.toEqual([
      expect.objectContaining({
        _id: `${tenantId}:member`,
        name: "Member",
        description: "Everything the workspace plan includes",
        permissions: [
          "general",
          "general.identity",
          "general.dangerZone",
          "billing.plan",
        ],
      }),
    ]);
  });

  it.each([
    ["fr", "Membre"],
    ["fr-FR", "Membre"],
    ["de", "Member"],
    [undefined, "Member"],
  ])("names the role in the owner's language %s", async (language, name) => {
    const tenantId = randomUUID();

    await createDefaultMemberRole(tenantId, language);

    const [role] = await GetModel(RoleModel, tenantId).getAll();
    expect(role?.name).toBe(name);
  });
});
