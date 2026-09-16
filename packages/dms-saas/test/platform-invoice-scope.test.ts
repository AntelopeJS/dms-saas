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
import {
  setRealtimePresenceHook,
  TableViewMeta,
  TableViewRoutes,
} from "@antelopejs/interface-dms/base";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { adminUserInvoicesDataAPI } from "../src/data-api/platformOwner/admin-user-invoices";
import { invoicesDataAPI } from "../src/data-api/platformOwner/invoices";

const CONTROLLERS = [invoicesDataAPI, adminUserInvoicesDataAPI];
const LIST_ROUTES = ["list", "select", "count"];
const OWNER = { _id: "owner", name: "Owner" };
const PRESENCE_ACQUIRE = "1";
const invoiceTable = new Schema("invoice-scope-test", {
  invoices: { fields: {}, indexes: { documentType: {} } },
})
  .instance(CROSS_INSTANCE)
  .table("invoices");
const presence = vi.fn();
let current: Record<string, unknown> | undefined;
let isAllowed = true;

function request(query = ""): RequestContext {
  return {
    url: new URL(`https://example.test/invoices?${query}`),
  } as RequestContext;
}

function prepareRead(): void {
  vi.spyOn(Query, "GetModel").mockReturnValue({
    table: {},
    database: {},
    constructor: { fromDatabase: (row: unknown) => row },
  } as unknown as ReturnType<typeof Query.GetModel>);
  vi.spyOn(Query, "Get").mockImplementation(
    () => Promise.resolve(current) as unknown as ReturnType<typeof Query.Get>,
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
    CheckTenantAccess: async () =>
      isAllowed ? { allowed: true } : { allowed: false, code: "test.denied" },
  });
});

beforeEach(() => {
  current = { _id: "invoice", documentType: "invoice" };
  isAllowed = true;
  presence.mockClear();
  setRealtimePresenceHook(presence);
});

afterEach(() => {
  vi.restoreAllMocks();
  setRealtimePresenceHook(undefined);
});

describe.each(CONTROLLERS)("%s invoice scope", (Controller) => {
  const controller = new Controller();
  const meta = GetDataControllerMeta(controller);

  function get() {
    return meta.endpoints.get.callback.func.call(
      controller,
      request(),
      { id: "invoice" },
      OWNER,
      "session",
      PRESENCE_ACQUIRE,
      OWNER,
    );
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
    expect(predicate).toBeInstanceOf(ValueProxy);
    expect((predicate as ValueProxy<boolean>).build().at(-1)).toMatchObject({
      stage: "eq",
      args: ["invoice"],
    });
  });

  it("rejects a credit note before projection and presence acquisition", async () => {
    current = { _id: "invoice", documentType: "credit_note" };
    prepareRead();

    await expect(get()).rejects.toMatchObject({
      status: 404,
      body: "saas.errors.invoice.not_found",
    });
    expect(Query.Get).toHaveBeenCalledTimes(1);
    expect(Query.ReadProperties).not.toHaveBeenCalled();
    expect(presence).not.toHaveBeenCalled();
  });

  it.each(["invoice", undefined])(
    "allows document type %s",
    async (documentType) => {
      current = { _id: "invoice", documentType };
      prepareRead();

      await expect(get()).resolves.toEqual({ _id: "invoice" });
      expect(Query.Get).toHaveBeenCalledTimes(1);
      expect(presence).toHaveBeenCalledTimes(1);
    },
  );

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
