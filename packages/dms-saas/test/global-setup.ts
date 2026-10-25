import { MongoBinary } from "mongodb-memory-server-core";

/** The mongod version every Mongo-backed suite pins. */
const MONGOD_VERSION = "8.0.8";

/**
 * Downloads mongod once, before any worker starts. Parallel workers that each
 * find it missing race on the download lock and time out in `beforeAll`.
 */
export default async function setup(): Promise<void> {
  await MongoBinary.getPath({ version: MONGOD_VERSION });
}
