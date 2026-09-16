import { Query, Schema } from "@antelopejs/interface-database";
import type { QueryStage } from "@antelopejs/interface-database/common";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InvoiceModel } from "@antelopejs/interface-dms-saas/db/models/invoices.model";
import { Invoice } from "@antelopejs/interface-dms-saas/db/tables/invoices.table";

type Row = Record<string, unknown>;
type StageHandler = (rows: Row[], stage: QueryStage) => Row[];
interface Expression {
  stages: QueryStage[];
}

const ROW_COUNT = 10_000;
const schema = new Schema("query-pushdown-test", {});

function matches(row: Row, stage: QueryStage): boolean {
  const expression = stage.args[0].args[1] as Expression;
  const [, field, compare] = expression.stages;
  const value = row[field.args[0]];
  const comparisons: Record<string, boolean> = {
    eq: value === compare.args[0],
    ne: value !== compare.args[0],
  };
  return comparisons[compare.stage];
}

const handlers: Record<string, StageHandler> = {
  schema: (rows) => rows,
  instance: (rows) => rows,
  table: (rows) => rows,
  getAll: (rows, stage) =>
    rows.filter((row) => row[stage.options.index] === stage.args[0]),
  filter: (rows, stage) => rows.filter((row) => matches(row, stage)),
  orderBy: (rows, stage) => {
    const direction = stage.options.direction === "desc" ? -1 : 1;
    return [...rows].sort((left, right) => {
      const a = left[stage.options.index] as number;
      const b = right[stage.options.index] as number;
      return (a < b ? -1 : a > b ? 1 : 0) * direction;
    });
  },
  slice: (rows, stage) =>
    rows.slice(stage.args[0], stage.args[0] + stage.args[1]),
};

function captureQueries(instances: Record<string, Row[]>) {
  const queries: QueryStage[][] = [];
  const transferred: number[] = [];
  vi.spyOn(Query.prototype, "run").mockImplementation(
    async function (this: Query<unknown>) {
      queries.push(this.stages);
      const instance = this.stages.find((stage) => stage.stage === "instance");
      const rows = this.stages.reduce(
        (rows, stage) => handlers[stage.stage](rows, stage),
        instances[instance?.options.id] ?? [],
      );
      transferred.push(rows.length);
      return rows;
    },
  );
  return { queries, transferred };
}

afterEach(() => vi.restoreAllMocks());

describe("invoice query pushdown", () => {
  it("only transfers invoices, never credit notes", async () => {
    const rows: Row[] = [
      { _id: "invoice", documentType: "invoice" },
      { _id: "other-invoice", documentType: "invoice" },
      ...Array.from({ length: ROW_COUNT }, (_, id) => ({
        _id: `credit-${id}`,
        documentType: "credit_note",
      })),
    ];
    const capture = captureQueries({
      a: rows,
      b: [{ _id: "other-tenant", documentType: "invoice" }],
    });
    const model = new InvoiceModel(schema.instance("a"));
    const result = await model.getAllInvoices();
    expect(result.every((row) => row instanceof Invoice)).toBe(true);
    expect(result).toEqual(
      rows.filter((row) => row.documentType !== "credit_note"),
    );
    expect(capture.transferred).toEqual([2]);
    expect(capture.queries[0].map((stage) => stage.stage)).toEqual([
      "schema",
      "instance",
      "table",
      "filter",
    ]);
  });

  it("limits after status selection and descending date ordering", async () => {
    const rows = Array.from({ length: ROW_COUNT }, (_, id) => ({
      _id: String(id),
      status: id % 2 ? "paid" : "open",
      issuedAt: new Date(id),
    }));
    const capture = captureQueries({ a: rows });
    const model = new InvoiceModel(schema.instance("a"));
    const expected = rows.filter((row) => row.status === "open").at(-1);
    expect(await model.findLatestOpen()).toEqual(expected);
    expect(capture.transferred).toEqual([1]);
    expect(capture.queries[0].slice(-3).map((stage) => stage.stage)).toEqual([
      "getAll",
      "orderBy",
      "slice",
    ]);
  });

  it("returns undefined for an empty tenant without querying another tenant", async () => {
    const capture = captureQueries({ b: [{ status: "open" }] });
    expect(
      await new InvoiceModel(schema.instance("a")).findLatestOpen(),
    ).toBeUndefined();
    expect(capture.transferred).toEqual([0]);
  });
});
