import type { RequestContext } from "@antelopejs/interface-api";
import { ImplementInterface } from "@antelopejs/interface-core";
import { GetDataControllerMeta } from "@antelopejs/interface-data-api";
import type { Parameters } from "@antelopejs/interface-data-api/components";
import * as tableViewBase from "@antelopejs/interface-dms/base";
import * as tenantAccess from "@antelopejs/interface-dms/tenant-access";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { workspacesDataAPI } from "../src/data-api/platformOwner/workspaces";

const OWNER = { _id: "owner", name: "Owner" };
const BATCH_ENDPOINT = "/count/batch";
const TOTALS_BY_STATE: Record<string, number> = {
  active: 4,
  free: 2,
  past_due: 1,
  suspended: 0,
};

const countWithSearch = vi.fn(
  async (
    _controller: unknown,
    _ctx: RequestContext,
    params: Parameters.ListParameters,
  ) => {
    const [state] = params.filters?.billingState ?? [];
    return { total: TOTALS_BY_STATE[String(state)] ?? 0 };
  },
);

function tabQuery(state: string) {
  return { id: state, query: { filter_billingState: `is:${state}` } };
}

beforeAll(() => {
  ImplementInterface(tenantAccess, {
    internal: {
      RegisterTenantAccessGate: { register() {}, unregister() {} },
    },
    CheckTenantAccess: async () => ({ allowed: true }),
  });
  ImplementInterface(
    { countWithSearch: tableViewBase.countWithSearch },
    { countWithSearch },
  );
});

beforeEach(() => {
  countWithSearch.mockClear();
});

describe("workspaces table tab counters", () => {
  const controller = new workspacesDataAPI();
  const meta = GetDataControllerMeta(controller);
  const entry = meta.endpoints.countBatch;

  it("mounts the DMS batch count route", () => {
    expect(entry?.callback).toBe(
      tableViewBase.TableViewRoutes.CountBatch.callback,
    );
    expect(entry?.endpoint).toBe(BATCH_ENDPOINT);
    expect(entry?.callback.method).toBe("post");
  });

  it("answers one count per status tab through the list query pipeline", async () => {
    const states = Object.keys(TOTALS_BY_STATE);
    const ctx = Object.assign(
      {
        url: new URL(
          `https://example.test/api/saas/tables/workspaces${BATCH_ENDPOINT}`,
        ),
      },
      { dataAPIEntry: entry },
    ) as unknown as RequestContext;

    const counts = await entry.callback.func.call(
      controller,
      ctx,
      { queries: states.map(tabQuery) },
      OWNER,
    );

    expect(counts).toEqual(TOTALS_BY_STATE);
    expect(countWithSearch).toHaveBeenCalledTimes(states.length);
  });
});
