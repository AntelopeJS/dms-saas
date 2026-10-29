import { MongoBinary, MongoMemoryReplSet } from "mongodb-memory-server-core";
import type { TestProject } from "vitest/node";

/** The mongod version every Mongo-backed suite pins. */
const MONGOD_VERSION = "8.0.8";

/**
 * Every suite opens a database of its own and every test a tenant of its own,
 * each a set of collections and indexes WiredTiger keeps a file open for. By
 * default mongod closes none while fewer than 2000 are open, and then only
 * those idle for ten minutes, so the run passes the usual 4096 open-file
 * limit within seconds and mongod aborts. A suite's files fall idle once it
 * ends: closing any file idle for a second keeps the open files to what the
 * running suites use.
 */
const MONGOD_FILE_HANDLE_ARGS = [
  "--wiredTigerEngineConfigString",
  "file_manager=(close_idle_time=1,close_scan_interval=1,close_handle_minimum=0)",
];

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
    replSet: { count: 1, args: MONGOD_FILE_HANDLE_ARGS },
    binary: { version: MONGOD_VERSION },
  });
  project.provide("mongoUri", replicaSet.getUri());
  return async () => {
    await replicaSet.stop();
  };
}
