import type { RequestContext } from "@antelopejs/interface-api";
import { GetDataControllerMeta } from "@antelopejs/interface-data-api";
import { Parameters, Query } from "@antelopejs/interface-data-api/components";
import {
  CROSS_INSTANCE,
  Datum,
  Schema,
  ValueProxy,
} from "@antelopejs/interface-database";
import { TenantMemberModel } from "@antelopejs/interface-dms/db";
import { describe, expect, it } from "vitest";
import { adminUserInvoicesDataAPI } from "../src/data-api/platformOwner/admin-user-invoices";

const controller = new adminUserInvoicesDataAPI();
const meta = GetDataControllerMeta(controller);
const schema = new Schema(TenantMemberModel.schemaName, {
  tenant_members: { fields: {}, indexes: { userId: {} } },
});
const database = schema.instance(CROSS_INSTANCE);

function request(query: string): RequestContext {
  return {
    url: new URL(`https://example.test/invoices?${query}`),
  } as RequestContext;
}

describe("admin user invoice filters", () => {
  it("extracts the virtual user filter alongside ordinary filters", () => {
    const filters = Parameters.ExtractFilters(
      request(
        "filter_userId=is:user&filter__instance=is:workspace&filter_status=is:paid",
      ),
      meta,
    );

    expect(filters).toEqual({
      userId: ["user", "is"],
      _instance: ["workspace", "is"],
      status: ["paid", "is"],
    });
    expect(meta.fields.userId.indexable).toBe(false);
    expect(meta.pluck.select.has("userId")).toBe(false);
    expect(meta.endpoints.select.options?.pluckMode).toBe("select");
  });

  it("builds a cross-instance membership existence query correlated to the invoice", () => {
    const ctx = Object.assign(request(""), { this: controller });
    const row = ValueProxy.constant({ _instance: "workspace,with-comma" });
    const predicate = meta.filters.userId(
      ctx,
      row,
      "userId",
      "user",
      "eq",
      row,
    );
    expect(predicate).toBeInstanceOf(ValueProxy);
    const stages = (predicate as ValueProxy<boolean>).build();
    expect(stages[0]).toMatchObject({ stage: "constant", args: [true] });
    expect(stages[1].stage).toBe("eq");
    const membership = stages[1].args[0] as Datum<unknown>;
    expect(membership).toBeInstanceOf(Datum);
    expect(membership.build()).toMatchObject([
      { stage: "schema", options: { id: TenantMemberModel.schemaName } },
      { stage: "instance", options: { id: CROSS_INSTANCE } },
      { stage: "table", options: { id: "tenant_members" } },
      { stage: "getAll", options: { index: "userId" }, args: ["user"] },
      { stage: "filter" },
      { stage: "map", args: [{ args: [expect.any(Array), true] }] },
      { stage: "nth", args: [0] },
    ]);
    const condition = membership.build()[4].args[0]
      .args[1] as ValueProxy<boolean>;
    const comparison = condition.build().at(-1);
    expect(comparison?.stage).toBe("eq");
    expect(comparison?.args[0].build()).toEqual(row.key("_instance").build());
  });

  it("applies the same filters to the result query and its total", () => {
    const ctx = request(
      "filter_userId=is:user&filter__instance=is:workspace&filter_status=is:paid",
    );
    const filters = Parameters.ExtractFilters(ctx, meta);
    const [results, total] = Query.List(
      controller,
      meta,
      database.table("invoices"),
      ctx,
      undefined,
      filters,
    );

    expect(
      results.build().filter((stage) => stage.stage === "filter"),
    ).toHaveLength(3);
    expect(total.build().slice(0, -1)).toEqual(results.build());
    expect(total.build().at(-1)?.stage).toBe("count");
  });

  it("combines the virtual user filter with the mandatory invoice scope", () => {
    const ctx = Object.assign(
      request("filter_userId=is:user&filter_documentType=is:credit_note"),
      {
        dataAPIEntry: meta.endpoints.list,
      },
    );
    const params = Parameters.ExtractGeneric<Parameters.ListParameters>(
      ctx,
      meta,
      {
        filters: Parameters.ExtractFilters,
      },
    );

    expect(params.filters).toEqual({
      documentType: ["invoice", "eq"],
      userId: ["user", "is"],
    });
  });
});
