import { onTestFinished, vi } from "vitest";
import { latch } from "./latch";

/** A model whose `insert` a test can hold back. */
interface InsertingModel {
  insert(...args: never[]): Promise<string[]>;
}

/**
 * Holds every insert through models of `prototype` until `replicas` of them
 * wait, as replicas that each read the table before any of them writes would.
 * Inserts after that run at once. The hold ends with the test.
 */
export function lineUpInserts(prototype: InsertingModel, replicas = 2): void {
  const lined = latch();
  let waiting = 0;
  const spy = vi.spyOn(prototype, "insert").mockImplementation(async function (
    this: InsertingModel,
    ...args: never[]
  ) {
    waiting += 1;
    if (waiting === replicas) {
      spy.mockRestore();
      lined.resolve();
    }
    await lined.promise;
    return this.insert(...args);
  });
  onTestFinished(() => spy.mockRestore());
}
