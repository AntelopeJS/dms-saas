import type { RequestContext } from "@antelopejs/interface-api";
import { ImplementInterface } from "@antelopejs/interface-core";
import {
  GetDataControllerMeta,
  type DataControllerCallback,
  type DataControllerCallbackWithOptions,
} from "@antelopejs/interface-data-api";
import type { Parameters } from "@antelopejs/interface-data-api/components";
import * as tableViewBase from "@antelopejs/interface-dms/base";
import * as tenantAccess from "@antelopejs/interface-dms/tenant-access";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { workspacesDataAPI } from "../src/data-api/platformOwner/workspaces";

const OWNER = { _id: "owner", name: "Owner" };
const BATCH_ENDPOINT = "/count/batch";
const TOTALS_BY_STATE = {
  active: 4,
  free: 2,
  past_due: 1,
  suspended: 0,
};
const TOTAL_BY_STATE_NAME = new Map(Object.entries(TOTALS_BY_STATE));

const countWithSearch = vi.fn(
  async (
    _controller: DataControllerCallback | DataControllerCallbackWithOptions,
    _ctx: RequestContext,
    params: Parameters.ListParameters,
  ) => {
    const [state] = params.filters?.billingState ?? [];
    return { total: TOTAL_BY_STATE_NAME.get(String(state)) ?? 0 };
  },
);

function tabQuery(state: string) {
  return `${state}?filter_billingState=is:${state}`;
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
    expect(entry?.callback.method).toBe("get");
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
    );

    const counts = await entry.callback.func.call(
      controller,
      ctx,
      states.map(tabQuery),
      OWNER,
    );

    expect(counts).toEqual(TOTALS_BY_STATE);
    expect(countWithSearch).toHaveBeenCalledTimes(states.length);
  });
});
