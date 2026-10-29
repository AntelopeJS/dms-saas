import { randomUUID } from "node:crypto";
import type { User } from "@antelopejs/interface-dms/auth/db";
import { fromPartial } from "@total-typescript/shoehorn";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { registerOwnerOnlyPermissionsResolver } from "../src/auth/owner-only-permissions-resolver";
import { addTenantMember } from "./helpers/dms";
import { useMongoDatabase } from "./helpers/mongo";
import {
  implementPermissionsResolvers,
  registeredResolver,
} from "./helpers/permissions-resolvers";

useMongoDatabase("owner-only-permissions-resolver");
const registered = implementPermissionsResolvers();

/** The workspace settings pages the owner-only surfaces sit on. */
const WORKSPACE_SETTINGS = "settings.workspace";

const MEMBER_GRANTS = [
  `${WORKSPACE_SETTINGS}.general`,
  `${WORKSPACE_SETTINGS}.general.identity`,
  `${WORKSPACE_SETTINGS}.general.dangerZone`,
  `${WORKSPACE_SETTINGS}.general.dangerZone.actions`,
  `${WORKSPACE_SETTINGS}.data-export`,
  `${WORKSPACE_SETTINGS}.data-export.request`,
];

const MEMBER_VIEW = [
  `${WORKSPACE_SETTINGS}.general`,
  `${WORKSPACE_SETTINGS}.general.identity`,
  `${WORKSPACE_SETTINGS}.general.dangerZone.actions`,
  `${WORKSPACE_SETTINGS}.data-export.request`,
];

/** The workspace of the current test, which "owner" owns and "member" joined. */
let tenantId = "";

function ownerOnly() {
  return registeredResolver(registered, "dms-saas.owner-only-surfaces");
}

function resolve(current: string[], userId = "member") {
  return ownerOnly().resolver(userId, tenantId, new Set(current), {});
}

beforeAll(() => {
  registerOwnerOnlyPermissionsResolver();
});

beforeEach(async () => {
  tenantId = randomUUID();
  await addTenantMember(tenantId, fromPartial<User>({ _id: "owner" }), true);
  await addTenantMember(tenantId, fromPartial<User>({ _id: "member" }), false);
});

describe("owner-only surfaces", () => {
  it("withholds the danger zone and the data export from a member granted everything", async () => {
    expect(await resolve(MEMBER_GRANTS)).toEqual(new Set(MEMBER_VIEW));
  });

  it("leaves an owner's permissions untouched", async () => {
    expect(await resolve(MEMBER_GRANTS, "owner")).toEqual(
      new Set(MEMBER_GRANTS),
    );
  });

  it("leaves the platform wildcard untouched", async () => {
    expect(await resolve(["*", `${WORKSPACE_SETTINGS}.data-export`])).toEqual(
      new Set(["*", `${WORKSPACE_SETTINGS}.data-export`]),
    );
  });

  describe("in a role preview", () => {
    function preview(current: string[], userId: string) {
      return ownerOnly().resolver(userId, tenantId, new Set(current), {
        preview: { rolePermissions: new Set(current) },
      });
    }

    it("withholds the owner-only surfaces, even for an owner's id", async () => {
      expect(await preview(MEMBER_GRANTS, "owner")).toEqual(
        new Set(MEMBER_VIEW),
      );
    });

    it("leaves a wildcard role untouched", async () => {
      expect(await preview(["*"], "member")).toEqual(new Set(["*"]));
    });

    it("leaves an owner's real call with an empty context untouched", async () => {
      expect(
        await ownerOnly().resolver(
          "owner",
          tenantId,
          new Set(MEMBER_GRANTS),
          {},
        ),
      ).toEqual(new Set(MEMBER_GRANTS));
    });
  });

  it("runs after the plan intersection", () => {
    expect(ownerOnly().order).toBeGreaterThan(100);
  });
});
