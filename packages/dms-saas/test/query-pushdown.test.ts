import { Query, Schema } from "@antelopejs/interface-database";
import type { QueryStage } from "@antelopejs/interface-database/common";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InvoiceModel } from "@antelopejs/interface-dms-saas/db/models/invoices.model";
import { Invoice } from "@antelopejs/interface-dms-saas/db/tables/invoices.table";
import { isNumber, isString } from "../src/utils/primitive-guards";
import { isRecord } from "./helpers/records";

type Row = Record<string, string | Date | undefined>;
type StageHandler = (rows: Row[], stage: QueryStage) => Row[];
interface Expression {
  stages: QueryStage[];
}

const ROW_COUNT = 10_000;
const schema = new Schema("query-pushdown-test", {});

function isQueryStage(value: unknown): value is QueryStage {
  return isRecord(value) && isString(value.stage) && Array.isArray(value.args);
}

function isExpression(value: unknown): value is Expression {
  return (
    isRecord(value) &&
    Array.isArray(value.stages) &&
    value.stages.every(isQueryStage)
  );
}

function matches(row: Row, stage: QueryStage): boolean {
  const expression: unknown = stage.args[0].args[1];
  if (!isExpression(expression)) {
    throw new Error(`The ${stage.stage} stage carries no expression`);
  }
  const [, field, compare] = expression.stages;
  const name: unknown = field.args[0];
  if (!isString(name)) throw new Error("The filter stage names no field");
  const value = Object.hasOwn(row, name) ? row[name] : undefined;
  if (compare.stage === "eq") return value === compare.args[0];
  return compare.stage === "ne" && value !== compare.args[0];
}

const handlers = new Map<string, StageHandler>([
  ["schema", (rows) => rows],
  ["instance", (rows) => rows],
  ["table", (rows) => rows],
  [
    "getAll",
    (rows, stage) =>
      rows.filter((row) => row[stage.options.index] === stage.args[0]),
  ],
  ["filter", (rows, stage) => rows.filter((row) => matches(row, stage))],
  [
    "orderBy",
    (rows, stage) => {
      const direction = stage.options.direction === "desc" ? -1 : 1;
      return [...rows].sort((left, right) => {
        const a = Number(left[stage.options.index]);
        const b = Number(right[stage.options.index]);
        return (a < b ? -1 : a > b ? 1 : 0) * direction;
      });
    },
  ],
  [
    "slice",
    (rows, stage) => {
      const start: unknown = stage.args[0];
      const count: unknown = stage.args[1];
      if (!isNumber(start) || !isNumber(count)) {
        throw new Error("The slice stage carries no bounds");
      }
      return rows.slice(start, start + count);
    },
  ],
]);

/** Runs one stage on the rows, as the database would. */
function runStage(rows: Row[], stage: QueryStage): Row[] {
  const handler = handlers.get(stage.stage);
  if (!handler) throw new Error(`No stand-in for the ${stage.stage} stage`);
  return handler(rows, stage);
}

function captureQueries(tenants: Record<string, Row[]>) {
  const instances = new Map(Object.entries(tenants));
  const queries: QueryStage[][] = [];
  const transferred: number[] = [];
  vi.spyOn(Query.prototype, "run").mockImplementation(
    async function (this: Query<unknown>) {
      queries.push(this.stages);
      const instance = this.stages.find((stage) => stage.stage === "instance");
      const id: unknown = instance?.options.id;
      const rows = this.stages.reduce(
        (rows, stage) => runStage(rows, stage),
        (isString(id) ? instances.get(id) : undefined) ?? [],
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
      rows.filter((row) => row.documentType === "invoice"),
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
