import type { DeepPartial } from "@antelopejs/interface-database-decorators";

/** The slice of a data model a keyed insert needs. */
export interface KeyedRowModel<Row> {
  get(id: string): PromiseLike<unknown>;
  insert(row: DeepPartial<Row>): PromiseLike<unknown>;
  update(id: string, patch: DeepPartial<Row>): PromiseLike<unknown>;
}

/**
 * Inserts a row under a stable key, or applies `patch` to the row a concurrent
 * writer committed under that key first. The primary key is the only
 * uniqueness the database adapters guarantee, so it is what fences writers
 * that each saw no row before inserting.
 *
 * @param model Model owning the row
 * @param id Stable key of the row
 * @param row Full row to insert, carrying `id` as its `_id`
 * @param patch Changes to apply when the row already exists
 */
export async function insertOrUpdateById<Row>(
  model: KeyedRowModel<Row>,
  id: string,
  row: DeepPartial<Row>,
  patch: DeepPartial<Row>,
): Promise<void> {
  try {
    await model.insert(row);
  } catch (error) {
    if (!(await model.get(id))) throw error;
    await model.update(id, patch);
  }
}
