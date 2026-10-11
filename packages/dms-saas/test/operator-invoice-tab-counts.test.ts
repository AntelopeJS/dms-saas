import type { RequestContext } from "@antelopejs/interface-api";
import { ImplementInterface } from "@antelopejs/interface-core";
import { GetDataControllerMeta } from "@antelopejs/interface-data-api";
import type { Parameters } from "@antelopejs/interface-data-api/components";
import * as tableViewBase from "@antelopejs/interface-dms/base";
import * as tenantAccess from "@antelopejs/interface-dms/tenant-access";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { invoicesDataAPI } from "../src/data-api/platformOwner/invoices";

const OWNER = { _id: "owner", name: "Owner" };
const filtersSeen: Parameters.ListParameters["filters"][] = [];

beforeAll(() => {
  ImplementInterface(tenantAccess, {
    internal: {
      RegisterTenantAccessGate: { register() {}, unregister() {} },
    },
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

describe("operator invoices tab counters", () => {
  it("counts each tab over invoices only, as the list shows them", async () => {
    const controller = new invoicesDataAPI();
    const entry = GetDataControllerMeta(controller).endpoints.countBatch;
    const ctx = Object.assign(
      { url: new URL("https://example.test/api/saas/tables/invoices") },
      { dataAPIEntry: entry },
    ) as unknown as RequestContext;

    const counts = await entry.callback.func.call(
      controller,
      ctx,
      {
        queries: [
          { id: "all", query: {} },
          { id: "void", query: { filter_status: "is:void" } },
        ],
      },
      OWNER,
    );

    expect(counts).toEqual({ all: 1, void: 1 });
    expect(filtersSeen).toEqual([
      { documentType: ["invoice", "eq"] },
      { documentType: ["invoice", "eq"], status: ["void", "is"] },
    ]);
  });
});
