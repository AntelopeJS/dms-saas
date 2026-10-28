import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { ImplementInterface } from "@antelopejs/interface-core";
import * as queries from "@antelopejs/interface-database/query";
import { afterEach, beforeAll } from "vitest";

const require = createRequire(import.meta.url);

/** The MongoDB module's implementation of the database query interface. */
export const mongoQueries: typeof queries = require(
  join(
    dirname(require.resolve("@antelopejs/mongodb/package.json")),
    "dist/implementations/database/query.js",
  ),
);

/** A table's queries held back until the test lets them go or fail them. */
export interface QueryHold {
  /** Lets the held queries through to the database. */
  release(): void;
  /** Fails the held queries with `error`, as a database that refuses them. */
  fail(error: Error): void;
}

/** What the suite's database was asked, and which of it the test holds back. */
export interface QueryGate {
  /** How many queries have reached `table`, held or not. */
  reads(table: string): number;
  /** Holds every query on `table` from now on, until the returned hold decides. */
  hold(table: string): QueryHold;
}

/** The tables a query reads or writes, from its stages. */
function tablesOf(stages: Parameters<typeof queries.RunQuery>[0]): string[] {
  return stages.flatMap((stage) =>
    stage.stage === "table" && stage.options?.id ? [stage.options.id] : [],
  );
}

/**
 * Wraps the database's query interface so a test can see which tables were
 * queried and hold a table's queries back, to order the work that waits on
 * them. Call it at the top level of a test file, after `useMongoDatabase`;
 * holds are dropped (released) after each test.
 */
export function useQueryGate(): QueryGate {
  const reached = new Map<string, number>();
  const holds = new Map<string, Promise<void>>();
  const releases: (() => void)[] = [];
  beforeAll(() => {
    ImplementInterface(queries, {
      ...mongoQueries,
      RunQuery: async (stages) => {
        for (const table of tablesOf(stages)) {
          reached.set(table, (reached.get(table) ?? 0) + 1);
          await holds.get(table);
        }
        return mongoQueries.RunQuery(stages);
      },
    });
  });
  afterEach(() => {
    for (const release of releases.splice(0)) release();
    holds.clear();
    reached.clear();
  });
  return {
    reads: (table) => reached.get(table) ?? 0,
    hold: (table) => {
      const hold = Promise.withResolvers<void>();
      hold.promise.catch(() => undefined);
      holds.set(table, hold.promise);
      releases.push(hold.resolve);
      return { release: hold.resolve, fail: hold.reject };
    },
  };
}
