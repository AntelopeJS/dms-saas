import type { Table } from "@antelopejs/interface-database-decorators";
import { isString } from "./primitive-guards";

const INSTANCE_FIELD = "_instance";

/** The instance id every AntelopeJS table row carries on a private field. */
export function getRowInstance(row: Table): string {
  const instance = INSTANCE_FIELD in row ? row[INSTANCE_FIELD] : undefined;
  if (!isString(instance)) throw new Error(`Row has no ${INSTANCE_FIELD}`);
  return instance;
}
