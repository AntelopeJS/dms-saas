import { randomUUID } from "node:crypto";
import { RegisterSchema } from "@antelopejs/interface-database-decorators";
import { construct, destroy } from "@antelopejs/mongodb";
import { afterAll, beforeAll, inject } from "vitest";

/** How long connecting and registering the DMS schemas may take on a slow runner. */
const CONNECT_TIMEOUT_MS = 60_000;

/**
 * Connects the suite to a database of its own on the replica set the global
 * setup started, registers the DMS core and tenant schemas the module's models
 * live in, and disconnects once the suite has run. Call it at the top level of
 * a test file; every `GetModel` of the suite then reads and writes real rows.
 *
 * @param name Prefix of the suite's database, followed by a random suffix
 */
export function useMongoDatabase(name: string): void {
  beforeAll(async () => {
    await construct({
      url: inject("mongoUri"),
      database: `${name}-${randomUUID()}`,
    });
    await RegisterSchema("dms-core");
    await RegisterSchema("dms-tenant");
  }, CONNECT_TIMEOUT_MS);
  afterAll(async () => {
    await destroy();
  });
}
