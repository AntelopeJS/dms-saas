import type { RequestContext } from "@antelopejs/interface-api";
import { ImplementInterface } from "@antelopejs/interface-core";
import { GetDataControllerMeta } from "@antelopejs/interface-data-api";
import { Parameters } from "@antelopejs/interface-data-api/components";
import { AccessMode } from "@antelopejs/interface-data-api/metadata";
import { ValueProxy } from "@antelopejs/interface-database";
import * as tableViewBase from "@antelopejs/interface-dms/base";
import * as tenantAccess from "@antelopejs/interface-dms/tenant-access";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { plansDataAPI } from "../src/data-api/platformOwner/plans";
import { SaasPlansApiController } from "../src/routes/platformOwner/plans";

const OWNER = { _id: "owner", name: "Owner" };
const NOT_DELETED = { isDeleted: ["false", "eq"] };
const SCOPED_ROUTES = ["list", "select", "count", "exportStart"];
const filtersSeen: Parameters.ListParameters["filters"][] = [];

const controller = new plansDataAPI();
const meta = GetDataControllerMeta(controller);

function request(route: string, query = ""): RequestContext {
  return Object.assign(
    { url: new URL(`https://example.test/plans?${query}`) },
    { dataAPIEntry: meta.endpoints[route] },
  ) as unknown as RequestContext;
}

beforeAll(() => {
  ImplementInterface(tenantAccess, {
    internal: {
      RegisterTenantAccessGate: { register() {}, unregister() {} },
    },
    EvaluateTenantAccess: async () => [],
    CheckTenantAccess: async () => ({ allowed: true }),
  });
  ImplementInterface(
    { countWithSearch: tableViewBase.countWithSearch },
    {
      countWithSearch: vi.fn(
        async (
          _controller: unknown,
          _ctx: RequestContext,
          params: Parameters.ListParameters,
        ) => {
          filtersSeen.push(params.filters);
          return { total: 1 };
        },
      ),
    },
  );
});

describe("the plans table scope", () => {
  it.each(SCOPED_ROUTES)("leaves deleted plans out of %s", (route) => {
    const filters = Parameters.ExtractFilters(
      request(route, "filter_isDeleted=eq:true&filter_isActive=is:true"),
      meta,
    );

    expect(filters).toEqual({ ...NOT_DELETED, isActive: ["true", "is"] });
  });

  it("counts each tab over the plans the list shows", async () => {
    filtersSeen.length = 0;
    const entry = meta.endpoints.countBatch;

    await entry.callback.func.call(
      controller,
      request("countBatch"),
      {
        queries: [
          { id: "all", query: {} },
          { id: "legacy", query: { filter_isActive: "is:false" } },
        ],
      },
      OWNER,
    );

    expect(filtersSeen).toEqual([
      NOT_DELETED,
      { ...NOT_DELETED, isActive: ["false", "is"] },
    ]);
  });

  it("matches the plans whose deletion flag is the one asked", () => {
    const row = ValueProxy.constant({ isDeleted: false });
    const predicate = meta.filters.isDeleted(
      Object.assign(request("list"), { this: controller }),
      row.key("isDeleted"),
      "isDeleted",
      "false",
      "eq",
      row,
    );

    expect((predicate as ValueProxy<boolean>).build().at(-1)).toMatchObject({
      stage: "eq",
      args: [false],
    });
  });
});

describe("moving plans by hand", () => {
  it("writes nothing but the position", () => {
    const writable = Object.entries(meta.fields)
      .filter(([, field]) => (field.mode ?? 0) & AccessMode.WriteOnly)
      .map(([name]) => name);

    expect(writable).toEqual(["order"]);
    expect(meta.endpoints.edit).toBeDefined();
  });

  it("no longer goes through a reorder route of its own", () => {
    expect("reorder" in SaasPlansApiController.prototype).toBe(false);
  });
});
