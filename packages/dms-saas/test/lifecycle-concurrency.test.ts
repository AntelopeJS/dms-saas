import { randomUUID } from "node:crypto";
import { ImplementInterface } from "@antelopejs/interface-core";
import {
  GetModel,
  RegisterSchema,
} from "@antelopejs/interface-database-decorators";
import { construct, destroy } from "@antelopejs/mongodb";
import { MongoMemoryReplSet } from "mongodb-memory-server-core";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import * as lifecycleImplementation from "../src/implementations/dms-saas/workspace-lifecycle";
import * as lifecycleInterface from "@antelopejs/interface-dms-saas/workspace-lifecycle";
import { LifecycleDeliveryModel } from "../src/operator-actions/db/lifecycle-delivery.model";
import {
  dispatchWorkspaceLifecycle,
  reconcileWorkspaceLifecycleDeliveries,
} from "../src/operator-actions/lifecycle-outbox";

const DATABASE = "saas-concurrency-test";
const SCHEMA = "dms-core";
const MONGO_VERSION = "8.0.8";
const SETUP_TIMEOUT_MS = 60_000;
const CONTENDERS = 12;

let mongodb: MongoMemoryReplSet;
let registration:
  | lifecycleInterface.WorkspaceLifecycleConsumerRegistration
  | undefined;

beforeAll(async () => {
  ImplementInterface(lifecycleInterface, lifecycleImplementation);
  mongodb = await MongoMemoryReplSet.create({
    replSet: { count: 1 },
    binary: { version: MONGO_VERSION },
  });
  await construct({ url: mongodb.getUri(), database: DATABASE });
  await RegisterSchema(SCHEMA);
}, SETUP_TIMEOUT_MS);

afterEach(() => {
  vi.restoreAllMocks();
  registration?.unregister();
  registration = undefined;
});

afterAll(async () => {
  try {
    await destroy();
  } finally {
    await mongodb?.stop();
  }
});

function failNextOutcomePersistence(model: LifecycleDeliveryModel): void {
  vi.spyOn(model, "markSucceeded").mockRejectedValueOnce(
    new Error("connection lost"),
  );
  vi.spyOn(model, "markFailed").mockRejectedValueOnce(
    new Error("connection lost"),
  );
}

describe("lifecycle delivery concurrency with the MongoDB provider", () => {
  it("persists a terminal receipt under concurrent completion and rejects stale failure", async () => {
    const model = GetModel(LifecycleDeliveryModel);
    const id = randomUUID();
    await model.insert({
      _id: id,
      operationId: id,
      tenantId: "tenant",
      consumer: "consumer",
      transition: "suspended",
      status: "pending",
      attemptCount: 0,
      revision: randomUUID(),
    });
    const delivery = await model.get(id);
    if (!delivery) throw new Error("Pending delivery is missing");
    await Promise.all(
      Array.from({ length: CONTENDERS }, () =>
        model.markSucceeded(delivery, { receiptId: "accepted" }),
      ),
    );
    await model.markFailed(delivery);
    expect((await model.get(id))?.status).toBe("succeeded");
    expect((await model.get(id))?.receiptId).toBe("accepted");
  });

  it("replays an effect after loss of both completion and failure persistence", async () => {
    const model = GetModel(LifecycleDeliveryModel);
    const operationId = randomUUID();
    const effects = new Set<string>();
    const consume = vi.fn(
      async (message: lifecycleInterface.WorkspaceLifecycleMessage) => {
        effects.add(message.operationId);
        return { receiptId: message.operationId };
      },
    );
    registration = lifecycleInterface.RegisterWorkspaceLifecycleConsumer({
      name: "durable.consumer",
      transitions: ["suspended"],
      consume,
    });
    failNextOutcomePersistence(model);
    await expect(
      dispatchWorkspaceLifecycle({
        operationId,
        tenantId: "tenant",
        transition: "suspended",
        requestedAt: new Date(),
      }),
    ).rejects.toThrow("connection lost");
    const [delivery] = await model.findByOperation(operationId);
    expect(delivery.status).toBe("pending");
    expect(effects.size).toBe(1);
    await reconcileWorkspaceLifecycleDeliveries();
    expect(consume).toHaveBeenCalledTimes(2);
    expect(consume.mock.calls[0][0]).toEqual(consume.mock.calls[1][0]);
    expect(effects.size).toBe(1);
    expect((await model.get(delivery._id))?.receiptId).toBe(operationId);
  });
});
