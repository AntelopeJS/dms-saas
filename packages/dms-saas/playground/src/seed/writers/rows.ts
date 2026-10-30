import type { Class } from "@antelopejs/interface-core/decorators";
import type { InstanceId, Table } from "@antelopejs/interface-database";
import {
  type DataModel,
  type DeepPartial,
  GetModel,
  triggerEvent,
} from "@antelopejs/interface-database-decorators";
import type { DayOffset } from "../data/types";

const MS_PER_DAY = 86_400_000;
const MS_PER_MINUTE = 60_000;

/** The date `days` away from now; negative is in the past. */
export function dayFrom(days: DayOffset): Date {
  return new Date(Date.now() + days * MS_PER_DAY);
}

/** `dayFrom`, kept null when there is no date. */
export function optionalDayFrom(days: DayOffset | null): Date | null {
  return days === null ? null : dayFrom(days);
}

/** `date` moved by `minutes`. */
export function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * MS_PER_MINUTE);
}

/** A row in the form the table stores it. */
type StoredRow<T> = Exclude<Parameters<Table<T>["insert"]>[0], unknown[]>;

/** A table model whose statics convert rows, as every `BasicDataModel` has. */
export type SeedTable<T> = DataModel<T> &
  Class<{ readonly table: Table<T> }> & {
    toDatabase(row: T): StoredRow<T>;
  };

/**
 * A row to write: its id, and the fields the seed sets. A localized field is
 * written as one text per language, whatever `Text` is.
 */
export type SeedRow<T, Text = never> = { _id: string } & {
  [K in keyof DeepPartial<T>]: DeepPartial<T>[K] | Text;
};

/** Turns a fresh instance into what gets stored, before it is converted. */
export type PrepareInstance<T> = (instance: T) => T;

function keepInstance<T>(instance: T): T {
  return instance;
}

/**
 * Writes the rows whose id is not stored yet and leaves the others alone, so
 * a seed interrupted half-way completes on the next start.
 *
 * A row is stored the way the model's own `insert` stores it, so hashing and
 * revision modifiers run, then gets back the dates the seed chose: the
 * creation and update stamps would otherwise all read "now".
 *
 * @param model Table model to write through
 * @param rows Rows to write, each with its `_id`
 * @param instanceId Tenant of a tenant-scoped table
 * @param prepare Last touch on each instance, e.g. writing every locale
 */
export async function insertMissing<T extends object, Text = never>(
  model: SeedTable<T>,
  rows: SeedRow<T, Text>[],
  instanceId?: InstanceId,
  prepare: PrepareInstance<T> = keepInstance,
): Promise<void> {
  const { table } = GetModel(model, instanceId);
  for (const row of rows) {
    if (await table.get(row._id)) continue;
    const instance = prepare(model.fromPlainData(row));
    triggerEvent(instance, "insert");
    for (const [field, value] of Object.entries<unknown>(row)) {
      if (value instanceof Date) Reflect.set(instance, field, value);
    }
    await table.insert(model.toDatabase(instance)).run();
  }
}
