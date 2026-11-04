import { isString } from "./primitive-guards";

const INSTANCE_FIELD = "_instance";

// oxlint-disable-next-line anti-slop/no-object-parameters -- `object` is the contract: every AntelopeJS table row carries the instance id on this private field, and no public type declares it
export function getRowInstance(row: object): string {
  const instance = INSTANCE_FIELD in row ? row[INSTANCE_FIELD] : undefined;
  if (!isString(instance)) throw new Error(`Row has no ${INSTANCE_FIELD}`);
  return instance;
}
