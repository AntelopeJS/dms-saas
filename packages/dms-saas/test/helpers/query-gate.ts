import { ImplementInterface } from "@antelopejs/interface-core";
import * as queries from "@antelopejs/interface-database/query";
import { afterEach, beforeAll } from "vitest";
import {
  CloseCursor,
  ReadCursor,
  RunQuery,
} from "../../node_modules/@antelopejs/mongodb/dist/implementations/database/query.js";
import { isRecord } from "./records";
import { isString } from "../../src/utils/primitive-guards";

/** The MongoDB module's implementation of the database query interface. */
export const mongoQueries = { RunQuery, ReadCursor, CloseCursor };

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
  return stages.flatMap((stage) => {
    const options: unknown = stage.options;
    return stage.stage === "table" &&
      isRecord(options) &&
      isString(options.id) &&
      options.id
      ? [options.id]
      : [];
  });
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
        const result: unknown = await mongoQueries.RunQuery(stages);
        return result;
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
      let release = (): void => undefined;
      let fail = (_error: Error): void => undefined;
      const held = new Promise<void>((resolve, reject) => {
        release = resolve;
        fail = reject;
      });
      held.catch(() => undefined);
      holds.set(table, held);
      releases.push(release);
      return { release, fail };
    },
  };
}
