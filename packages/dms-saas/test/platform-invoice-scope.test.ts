import { fromPartial } from "@total-typescript/shoehorn";
import assert from "node:assert/strict";
import type { RequestContext } from "@antelopejs/interface-api";
import { GetMetadata, ImplementInterface } from "@antelopejs/interface-core";
import { GetDataControllerMeta } from "@antelopejs/interface-data-api";
import {
  Parameters,
  Query,
  Validation,
} from "@antelopejs/interface-data-api/components";
import {
  CROSS_INSTANCE,
  Schema,
  ValueProxy,
} from "@antelopejs/interface-database";
import * as tenantAccess from "@antelopejs/interface-dms/tenant-access";
import { TableViewMeta, TableViewRoutes } from "@antelopejs/interface-dms/base";
import {
  type RealtimePresenceContext,
  internal as tableView,
} from "@antelopejs/interface-dms/base/table-view";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type { Invoice } from "../src/db";
import { invoicesDataAPI } from "../src/data-api/platformOwner/invoices";

/**
 * The user page's billing table lists credit notes too: only the invoices
 * table is scoped to invoices.
 */
const CONTROLLERS = [invoicesDataAPI];
const LIST_ROUTES = ["list", "select", "count"];
const OWNER = { _id: "owner", name: "Owner" };
const PRESENCE_ACQUIRE = "1";
const invoiceTable = new Schema("invoice-scope-test", {
  invoices: { fields: {}, indexes: { documentType: {} } },
})
  .instance(CROSS_INSTANCE)
  .table("invoices");
const presence = vi.fn(async (_context: RealtimePresenceContext) => {});
let current: Partial<Invoice> | undefined;
let isAllowed = true;

function request(query = ""): RequestContext {
  return fromPartial<RequestContext>({
    url: new URL(`https://example.test/invoices?${query}`),
  });
}

function prepareRead(): void {
  vi.spyOn(Query, "GetModel").mockReturnValue(
    fromPartial<ReturnType<typeof Query.GetModel>>({
      table: {},
      database: {},
      constructor: { fromDatabase: (row: typeof current) => row },
    }),
  );
  vi.spyOn(Query, "Get").mockImplementation(() =>
    fromPartial<ReturnType<typeof Query.Get>>(Promise.resolve(current)),
  );
  vi.spyOn(Query, "Joined").mockImplementation((_db, _meta, query) => query);
  vi.spyOn(Query, "Computed").mockImplementation((_db, _meta, query) => query);
  vi.spyOn(Query, "Foreign").mockImplementation((_db, _meta, query) => query);
  vi.spyOn(Validation, "Unlock").mockImplementation(() => {});
  vi.spyOn(Query, "ReadProperties").mockResolvedValue({ _id: "invoice" });
}

beforeAll(() => {
  ImplementInterface(tenantAccess, {
    internal: {
      RegisterTenantAccessGate: { register() {}, unregister() {} },
    },
    EvaluateTenantAccess: async () =>
      isAllowed ? [] : [{ gateId: "test", code: "test.denied" }],
    CheckTenantAccess: async () =>
      isAllowed ? { allowed: true } : { allowed: false, code: "test.denied" },
  });
  ImplementInterface(
    { internal: tableView },
    {
      internal: {
        AcquirePresence: presence,
        PublishMutation: async () => {},
      },
    },
  );
});

beforeEach(() => {
  current = { _id: "invoice", documentType: "invoice" };
  isAllowed = true;
  presence.mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe.each(CONTROLLERS)("%s invoice scope", (Controller) => {
  const controller = new Controller();
  const meta = GetDataControllerMeta(controller);

  function get() {
    const route = meta.endpoints.get.callback;
    const ctx = request();
    const args = [
      ctx,
      { id: "invoice" },
      OWNER,
      ctx,
      "session",
      PRESENCE_ACQUIRE,
      OWNER,
    ];
    assert.equal(args.length, route.args.length);
    return route.func.call(controller, ...args);
  }

  it.each(LIST_ROUTES)("merges mandatory and user filters on %s", (route) => {
    const entry = meta.endpoints[route];
    const ctx = Object.assign(
      request(
        "filter_documentType=is:credit_note&filter__instance=is:workspace&filter_status=is:paid&limit=7",
      ),
      { dataAPIEntry: entry },
    );
    const params = Parameters.ExtractGeneric<Parameters.ListParameters>(
      ctx,
      meta,
      {
        filters: Parameters.ExtractFilters,
        limit: "int",
      },
    );

    expect(params.filters).toEqual({
      documentType: ["invoice", "eq"],
      _instance: ["workspace", "is"],
      status: ["paid", "is"],
    });
    expect(params.limit).toBe(7);
    assert(params.filters);
    params.filters.documentType[0] = "changed";
    const next = Parameters.ExtractFilters(
      Object.assign(request(), { dataAPIEntry: entry }),
      meta,
    );
    expect(next).toEqual({ documentType: ["invoice", "eq"] });
  });

  it("uses native DMS callbacks and keeps the select projection", () => {
    expect(meta.endpoints.get.callback).toBe(TableViewRoutes.Get);
    expect(meta.endpoints.list.callback).toBe(TableViewRoutes.List);
    expect(meta.endpoints.select.callback).toBe(
      TableViewRoutes.Select.callback,
    );
    expect(meta.endpoints.count.callback).toBe(TableViewRoutes.Count);
    expect(meta.endpoints.select.options?.pluckMode).toBe("select");
    expect(
      GetMetadata(Controller, TableViewMeta).controllerGuards?.get,
    ).toBeTypeOf("function");
  });

  it("builds an indexed invoice query with a matching total", () => {
    const ctx = Object.assign(request("filter_status=is:paid"), {
      dataAPIEntry: meta.endpoints.list,
    });
    const filters = Parameters.ExtractFilters(ctx, meta);
    const [results, total] = Query.List(
      controller,
      meta,
      invoiceTable,
      ctx,
      undefined,
      filters,
    );

    expect(results.build()).toMatchObject([
      { stage: "schema" },
      { stage: "instance" },
      { stage: "table" },
      {
        stage: "getAll",
        options: { index: "documentType" },
        args: ["invoice"],
      },
      { stage: "filter" },
    ]);
    expect(total.build().slice(0, -1)).toEqual(results.build());
  });

  it("uses a native equality predicate for the mandatory filter", () => {
    const ctx = Object.assign(request(), {
      dataAPIEntry: meta.endpoints.list,
    });
    const filters = Parameters.ExtractFilters(ctx, meta);
    const row = ValueProxy.constant({ documentType: "invoice" });
    const predicate = meta.filters.documentType(
      Object.assign(ctx, { this: controller }),
      row.key("documentType"),
      "documentType",
      ...filters.documentType,
      row,
    );
    assert(predicate instanceof ValueProxy);
    expect(predicate.build().at(-1)).toMatchObject({
      stage: "eq",
      args: ["invoice"],
    });
  });

  it.each<Invoice["documentType"] | undefined>(["credit_note", undefined])(
    "rejects document type %s before projection and presence acquisition",
    async (documentType) => {
      current = { _id: "invoice", documentType };
      prepareRead();

      await expect(get()).rejects.toMatchObject({
        status: 404,
        body: "saas.errors.invoice.not_found",
      });
      expect(Query.Get).toHaveBeenCalledTimes(1);
      expect(Query.ReadProperties).not.toHaveBeenCalled();
      expect(presence).not.toHaveBeenCalled();
    },
  );

  it("allows invoice rows", async () => {
    current = { _id: "invoice", documentType: "invoice" };
    prepareRead();

    await expect(get()).resolves.toEqual({ _id: "invoice" });
    expect(Query.Get).toHaveBeenCalledTimes(1);
    expect(presence).toHaveBeenCalledTimes(1);
  });

  it("preserves missing-row 404s", async () => {
    current = undefined;
    prepareRead();
    await expect(get()).rejects.toMatchObject({ status: 404 });
    expect(Query.ReadProperties).not.toHaveBeenCalled();
    expect(presence).not.toHaveBeenCalled();
  });

  it("checks authorization before loading a document", async () => {
    isAllowed = false;
    prepareRead();
    await expect(get()).rejects.toMatchObject({ status: 403 });
    expect(Query.Get).not.toHaveBeenCalled();
    expect(presence).not.toHaveBeenCalled();
  });
});
