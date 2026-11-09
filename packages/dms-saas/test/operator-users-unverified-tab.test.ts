import { GetModel } from "@antelopejs/interface-database-decorators";
import { UserModel } from "@antelopejs/interface-dms/auth/db";
import * as tableViewBase from "@antelopejs/interface-dms/base";
import { DEFAULT_TENANT_ID } from "@antelopejs/interface-dms/constants";
import * as permissions from "@antelopejs/interface-dms/permissions";
import * as permissionsResolver from "@antelopejs/interface-dms/permissions-resolver";
import { beforeAll, describe, expect, it } from "vitest";
import "../src/data-api/platformOwner/users";
import { SaasUsersListController } from "../src/pages/platform/users";
import {
  createUser,
  implementWithDms,
  tenantRequest,
  useDmsAuth,
} from "./helpers/dms";
import { useMongoDatabase } from "./helpers/mongo";
import { isRecord } from "./helpers/records";
import { callRoute } from "./helpers/routes";

const COUNT_BATCH_ROUTE = "/api/saas/tables/users/count/batch";

useMongoDatabase();
useDmsAuth();

beforeAll(() => {
  implementWithDms(permissions, "implementations/dms/permissions.js");
  implementWithDms(
    permissionsResolver,
    "implementations/dms/permissions-resolver.js",
  );
  implementWithDms(
    { countWithSearch: tableViewBase.countWithSearch },
    "implementations/dms-base/table-view.js",
  );
});

/** The batch count query of a tab of the users list, from its own filter. */
async function tabQuery(id: string): Promise<string> {
  const { options } = await SaasUsersListController.table.serialize();
  const filter = options?.tabs?.find((tab) => tab.id === id)?.filter;
  const search = filter
    ? `filter_${filter.accessorKey}=${filter.mode}:${filter.value}`
    : "";
  return `${id}?${search}`;
}

/** Counts the users list tabs as the platform owner's browser asks for them. */
async function countTabs(ids: string[]): Promise<Map<string, unknown>> {
  const owner = await createUser({ owner: true });
  const request = await tenantRequest(owner, DEFAULT_TENANT_ID);
  const url = new URL(`https://example.test${COUNT_BATCH_ROUTE}`);
  for (const query of await Promise.all(ids.map(tabQuery)))
    url.searchParams.append("query", query);
  const counts: unknown = await callRoute(
    "GET",
    COUNT_BATCH_ROUTE,
    Object.assign(request, { url }),
  );
  if (!isRecord(counts)) throw new Error("Expected counts by tab");
  return new Map(Object.entries(counts));
}

describe("users list unverified tab", () => {
  it("counts the accounts stored without a verification flag", async () => {
    await createUser({ _id: "declined", isValidated: false });
    await GetModel(UserModel).insert({
      _id: "registered",
      email: "registered@example.test",
      name: "Registered",
      language: "en",
      password: null,
      authKey: "registered-key",
      owner: false,
      createdAt: new Date(),
    });

    await expect(countTabs(["all", "unverified"])).resolves.toEqual(
      new Map([
        ["all", 3],
        ["unverified", 2],
      ]),
    );
  });
});
