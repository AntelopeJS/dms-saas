import type { Class } from "@antelopejs/interface-core/decorators";
import type { InstanceId } from "@antelopejs/interface-database";
import {
  type DataModel,
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

/** A row in the form the database stores it. */
type StoredRow = Record<string, unknown>;

/** The part of a model's table the seed uses: read a row, write a row. */
interface SeedTableHandle {
  get(id: string): PromiseLike<unknown>;
  insert(row: StoredRow): Runnable;
}

interface Runnable {
  run(): PromiseLike<unknown>;
}

interface ModelInstance {
  readonly table: SeedTableHandle;
}

/** A table model whose statics convert rows, as every `BasicDataModel` has. */
export type SeedTable<T> = DataModel<T> &
  Class<ModelInstance> & {
    toDatabase(row: T): StoredRow;
  };

/** A row to write: its id, and the fields the seed sets. */
export type SeedRow = { _id: string } & Record<string, unknown>;

/** Turns a fresh instance into what gets stored, before it is converted. */
export type PrepareInstance<T> = (instance: T) => T;

function keepInstance<T>(instance: T): T {
  return instance;
}

function readDates(row: SeedRow): [string, Date][] {
  return Object.entries(row).filter(
    (entry): entry is [string, Date] => entry[1] instanceof Date,
  );
}

/**
 * Builds the stored form of a row the way the model's own `insert` does, so
 * hashing and revision modifiers run, then puts back the dates the seed
 * chose: the creation and update stamps would otherwise all read "now".
 */
function toStoredRow<T extends object>(
  model: SeedTable<T>,
  row: SeedRow,
  prepare: PrepareInstance<T>,
): StoredRow {
  const instance = prepare(model.fromPlainData(row));
  triggerEvent(instance, "insert");
  for (const [field, date] of readDates(row)) {
    Reflect.set(instance, field, date);
  }
  return model.toDatabase(instance);
}

/**
 * Writes the rows whose id is not stored yet and leaves the others alone, so
 * a seed interrupted half-way completes on the next start.
 *
 * @param model Table model to write through
 * @param rows Rows to write, each with its `_id`
 * @param instanceId Tenant of a tenant-scoped table
 * @param prepare Last touch on each instance, e.g. writing every locale
 */
export async function insertMissing<T extends object>(
  model: SeedTable<T>,
  rows: SeedRow[],
  instanceId?: InstanceId,
  prepare: PrepareInstance<T> = keepInstance,
): Promise<void> {
  const { table } = GetModel(model, instanceId);
  for (const row of rows) {
    if (await table.get(row._id)) continue;
    await table.insert(toStoredRow(model, row, prepare)).run();
  }
}
