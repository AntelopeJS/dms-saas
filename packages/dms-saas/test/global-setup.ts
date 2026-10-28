import { MongoBinary, MongoMemoryReplSet } from "mongodb-memory-server-core";
import type { TestProject } from "vitest/node";

/** The mongod version every Mongo-backed suite pins. */
const MONGOD_VERSION = "8.0.8";

declare module "vitest" {
  export interface ProvidedContext {
    /** The replica set every suite of {@link useMongoDatabase} shares. */
    mongoUri: string;
  }
}

/**
 * Downloads mongod once, before any worker starts. Parallel workers that each
 * find it missing race on the download lock and time out in `beforeAll`.
 * Then starts the one replica set the suites share, each in a database of its
 * own, and stops it once every suite has run.
 */
export default async function setup(
  project: TestProject,
): Promise<() => Promise<void>> {
  await MongoBinary.getPath({ version: MONGOD_VERSION });
  const replicaSet = await MongoMemoryReplSet.create({
    replSet: { count: 1 },
    binary: { version: MONGOD_VERSION },
  });
  project.provide("mongoUri", replicaSet.getUri());
  return async () => {
    await replicaSet.stop();
  };
}
