import { RegisterSchema } from "@antelopejs/interface-database-decorators";
import { GetClient } from "@antelopejs/interface-mongodb";
import { construct, destroy } from "@antelopejs/mongodb";
import { afterAll, beforeAll, inject } from "vitest";

/** How long connecting and registering the DMS schemas may take on a slow runner. */
const CONNECT_TIMEOUT_MS = 60_000;

/**
 * The database of the Vitest worker running this file. A worker runs one file
 * at a time, so the files of a worker take turns on one database, and the
 * collections and indexes the schemas declare are built once per worker
 * instead of once per file.
 */
function workerDatabase(): string {
  return `unit-worker-${process.env["VITEST_POOL_ID"] ?? "0"}`;
}

/** Deletes every document the previous files of this worker left behind. */
async function emptyDatabase(database: string): Promise<void> {
  const db = (await GetClient()).db(database);
  const collections = await db
    .listCollections({}, { nameOnly: true })
    .toArray();
  await Promise.all(
    collections
      .filter((collection) => !collection.name.startsWith("system."))
      .map((collection) => db.collection(collection.name).deleteMany({})),
  );
}

/**
 * Connects the suite to its worker's database on the replica set the global
 * setup started, empties it, registers the DMS core and tenant schemas the
 * module's models live in, and disconnects once the suite has run. Call it at
 * the top level of a test file; every `GetModel` of the suite then reads and
 * writes real rows, starting from no rows at all.
 */
export function useMongoDatabase(): void {
  beforeAll(async () => {
    const database = workerDatabase();
    await construct({ url: inject("mongoUri"), database });
    await emptyDatabase(database);
    await RegisterSchema("dms-core");
    await RegisterSchema("dms-tenant");
  }, CONNECT_TIMEOUT_MS);
  afterAll(async () => {
    await destroy();
  });
}
