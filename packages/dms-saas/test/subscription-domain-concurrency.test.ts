import { randomUUID } from "node:crypto";
import { HTTPResult } from "@antelopejs/interface-api";
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
import { TenantSubscriptionModel } from "@antelopejs/interface-dms-saas/db/models/tenantSubscriptions.model";
import type {
  SubscriptionTransition,
  TenantSubscription,
} from "@antelopejs/interface-dms-saas/db/tables/tenantSubscriptions.table";
import { CardCapacityModel } from "../src/workspaces/db/card-capacity.model";
import {
  TrialIdentityModel,
  trialIdentityId,
} from "../src/workspaces/db/trial-identity.model";
import { ProvisioningAttemptModel } from "../src/workspaces/db/provisioning-attempt.model";
import { reserveTrialIdentities } from "../src/workspaces/provisioning-state";
import type { WorkspaceProvisioningHandles } from "../src/workspaces/provisioning";
import { OperatorActionModel } from "../src/operator-actions/db/operator-action.model";
import {
  executeOperatorAction,
  type OperatorActionRequest,
} from "../src/operator-actions/journal";

const SETUP_TIMEOUT_MS = 60_000;
const CONTENDERS = 12;
const CAPACITY = 3;
let mongodb: MongoMemoryReplSet;

afterEach(() => vi.restoreAllMocks());

beforeAll(async () => {
  mongodb = await MongoMemoryReplSet.create({
    replSet: { count: 1 },
    binary: { version: "8.0.8" },
  });
  await construct({
    url: mongodb.getUri(),
    database: "saas-domain-concurrency",
  });
  await RegisterSchema("dms-core");
  await RegisterSchema("dms-tenant");
}, SETUP_TIMEOUT_MS);

afterAll(async () => {
  try {
    await destroy();
  } finally {
    await mongodb?.stop();
  }
});

async function subscription(
  model: TenantSubscriptionModel,
): Promise<TenantSubscription> {
  const id = randomUUID();
  await model.insert({
    _id: id,
    status: "active",
    planId: "paid",
    pastDueSince: new Date(0),
  });
  const current = await model.get(id);
  if (!current) throw new Error("Missing test subscription");
  return current;
}

function transition(): SubscriptionTransition {
  return {
    operationId: randomUUID(),
    kind: "suspend",
    targetPlanId: null,
    requestedAt: new Date(),
  };
}

describe("subscription domain admission on the production Mongo provider", () => {
  it("admits one conflicting intent and excludes ordinary writers until completion", async () => {
    const model = GetModel(TenantSubscriptionModel, randomUUID());
    const current = await subscription(model);
    const intents = Array.from({ length: CONTENDERS }, transition);
    const results = await Promise.allSettled(
      intents.map((intent) => model.beginTransition(current, intent)),
    );
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    await expect(
      model.update(current._id, { status: "cancelled" }),
    ).rejects.toThrow("requires reconciliation");
    const winner =
      intents[results.findIndex((result) => result.status === "fulfilled")];
    await model.completeTransition(current._id, winner.operationId, {
      status: "suspended",
    });
    const completed = await model.get(current._id);
    expect(completed?.status).toBe("suspended");
    expect(completed?.pastDueSince).toBeNull();
    expect(completed?.domainTransition).toBeNull();
    expect(completed?.revision).not.toBe(current.revision);
    await expect(model.beginTransition(current, winner)).rejects.toThrow(
      "not-applied",
    );
  });

  it("fences deletion against intent admission using the same observed revision", async () => {
    const model = GetModel(TenantSubscriptionModel, randomUUID());
    const current = await subscription(model);
    const marker = new Date();
    expect(
      await model.mutateRevision(current, { deletionStartedAt: marker }),
    ).toBe("applied");
    await expect(model.beginTransition(current, transition())).rejects.toThrow(
      "not-applied",
    );
    await expect(
      model.update(current._id, { status: "active" }),
    ).rejects.toThrow("requires reconciliation");
    expect((await model.get(current._id))?.deletionStartedAt).toEqual(marker);
  });

  it("bootstraps an absent revision but never interprets explicit null as absent", async () => {
    const model = GetModel(TenantSubscriptionModel, randomUUID());
    const id = randomUUID();
    await model.table.insert({ _id: id, status: "active" }).run();
    const legacy = await model.get(id);
    if (!legacy) throw new Error("Missing legacy subscription");
    expect(legacy.revision).toBeUndefined();
    await model.beginTransition(legacy, transition());
    expect(typeof (await model.get(id))?.revision).toBe("string");
    await model.table.get(id).update(JSON.parse('{"revision":null}')).run();
    const invalid = await model.get(id);
    if (!invalid) throw new Error("Missing null-revision subscription");
    expect(invalid.revision).toBeNull();
    await expect(
      model.beginTransition(invalid, transition()),
    ).rejects.toThrow();
    expect((await model.get(id))?.revision).toBeNull();
  });
});

describe("durable card capacity", () => {
  it("keeps uncertain reservations counted under concurrent admission", async () => {
    const model = GetModel(CardCapacityModel);
    const id = randomUUID();
    const tenants = Array.from({ length: CONTENDERS }, () => randomUUID());
    const results = await Promise.all(
      tenants.map((tenant) =>
        model.reserve(id, tenant, CAPACITY, async () => []),
      ),
    );
    expect(results.filter(Boolean)).toHaveLength(CAPACITY);
    expect((await model.get(id))?.allocations).toHaveLength(CAPACITY);
    expect(
      await model.reserve(id, randomUUID(), CAPACITY, async () => []),
    ).toBe(false);
    const accepted = tenants[results.indexOf(true)];
    expect(await model.reserve(id, accepted, CAPACITY, async () => [])).toBe(
      true,
    );
    await model.releaseCancelled(id, accepted);
    expect(
      await model.reserve(id, randomUUID(), CAPACITY, async () => []),
    ).toBe(true);
  });

  it("counts legacy live usage alongside unresolved reservations", async () => {
    const model = GetModel(CardCapacityModel);
    const id = randomUUID();
    expect(
      await model.reserve(id, "pending", CAPACITY, async () => [
        "legacy-a",
        "legacy-b",
      ]),
    ).toBe(true);
    expect(
      await model.reserve(id, "overflow", CAPACITY, async () => [
        "legacy-a",
        "legacy-b",
      ]),
    ).toBe(false);
    expect(
      await model.reserve(id, "replacement", CAPACITY, async () => [
        "legacy-b",
      ]),
    ).toBe(true);
    expect(
      (await model.get(id))?.allocations.map((entry) => entry.tenantId).sort(),
    ).toEqual(["legacy-b", "pending", "replacement"]);
  });
});

function operatorRequest(tenantId: string): OperatorActionRequest {
  return {
    operationId: randomUUID(),
    tenantId,
    actor: { id: "owner", email: "owner@example.test" },
    action: "workspace.suspend",
    details: {},
  };
}

async function provisioningHandles(): Promise<WorkspaceProvisioningHandles> {
  const tenantId = randomUUID();
  await GetModel(ProvisioningAttemptModel).insert({
    _id: tenantId,
    revision: randomUUID(),
    state: "preparing",
    trialIdentityIds: [],
  });
  return { tenantId };
}

describe("trial identity admission", () => {
  it("grants one trial per card across distinct email identities and releases the unused email", async () => {
    const attempts = await Promise.all(
      Array.from({ length: CONTENDERS }, provisioningHandles),
    );
    const fingerprint = randomUUID();
    const results = await Promise.all(
      attempts.map((handles, index) =>
        reserveTrialIdentities(handles, `${fingerprint}:${index}`, fingerprint),
      ),
    );
    expect(results.filter(Boolean)).toHaveLength(1);
    const winner = results.indexOf(true);
    const model = GetModel(TrialIdentityModel);
    expect(
      (await model.get(trialIdentityId("card", fingerprint)))?.tenantId,
    ).toBe(attempts[winner].tenantId);
    const loser = results.indexOf(false);
    expect(
      (await model.get(trialIdentityId("email", `${fingerprint}:${loser}`)))
        ?.tenantId,
    ).toBeNull();
  });

  it("retains an ambiguous reservation with persisted recovery identities", async () => {
    const handles = await provisioningHandles();
    const emailHash = randomUUID();
    const model = GetModel(TrialIdentityModel);
    const reserve = model.reserve.bind(model);
    vi.spyOn(model, "reserve").mockImplementationOnce(async (id, tenantId) => {
      await reserve(id, tenantId);
      throw new Error("reservation acknowledgement unknown");
    });
    await expect(
      reserveTrialIdentities(handles, emailHash, null),
    ).rejects.toThrow("acknowledgement unknown");
    const id = trialIdentityId("email", emailHash);
    expect(
      (await GetModel(ProvisioningAttemptModel).get(handles.tenantId!))
        ?.trialIdentityIds,
    ).toEqual([id]);
    expect(await reserve(id, randomUUID())).toBe(false);
    expect(handles.mustPreserveWorkspace).toBe(true);
  });
});

describe("operator execution without timed takeover", () => {
  it("retains intent when a downstream HTTP failure follows admission", async () => {
    const tenantId = randomUUID();
    const model = GetModel(TenantSubscriptionModel, tenantId);
    const current = await subscription(model);
    const request = operatorRequest(tenantId);
    const effect = vi.fn(async () => {
      await model.beginTransition(current, {
        ...transition(),
        operationId: request.operationId,
      });
      throw new HTTPResult(409, "saas.errors.operator.downstream_failed");
    });
    await expect(executeOperatorAction(request, effect)).rejects.toMatchObject({
      status: 409,
    });
    expect(
      (await GetModel(OperatorActionModel).get(request.operationId))?.status,
    ).toBe("reconciliation_required");
    await expect(executeOperatorAction(request, effect)).rejects.toMatchObject({
      status: 409,
    });
    expect(effect).toHaveBeenCalledTimes(1);
    expect((await model.get(current._id))?.domainTransition?.operationId).toBe(
      request.operationId,
    );
  });

  it("never admits a conflicting command after the old lease duration or releases its uncertain intent", async () => {
    const tenantId = randomUUID();
    const model = GetModel(TenantSubscriptionModel, tenantId);
    const current = await subscription(model);
    const request = operatorRequest(tenantId);
    let resume: () => void = () => undefined;
    const paused = new Promise<void>((resolve) => {
      resume = resolve;
    });
    const effect = vi.fn(async () => {
      await model.beginTransition(current, {
        ...transition(),
        operationId: request.operationId,
      });
      await paused;
      return { details: {}, effectiveAt: new Date() };
    });
    const first = executeOperatorAction(request, effect).catch(
      (error: unknown) => error,
    );
    await vi.waitFor(async () =>
      expect(
        (await model.get(current._id))?.domainTransition?.operationId,
      ).toBe(request.operationId),
    );
    const later = Date.now() + 10 * 60 * 1000;
    vi.spyOn(Date, "now").mockReturnValue(later);
    await expect(executeOperatorAction(request, effect)).rejects.toMatchObject({
      status: 409,
    });
    await expect(
      model.beginTransition((await model.get(current._id))!, transition()),
    ).rejects.toThrow("different pending");
    resume();
    await first;
    expect(effect).toHaveBeenCalledTimes(1);
    expect(
      (await GetModel(OperatorActionModel).get(request.operationId))?.status,
    ).toBe("reconciliation_required");
    expect((await model.get(current._id))?.domainTransition?.operationId).toBe(
      request.operationId,
    );
  });

  it("retains admission after an external effect succeeds but success persistence is unknown", async () => {
    const tenantId = randomUUID();
    const model = GetModel(TenantSubscriptionModel, tenantId);
    const current = await subscription(model);
    const request = operatorRequest(tenantId);
    const effects: string[] = [];
    vi.spyOn(
      GetModel(OperatorActionModel),
      "markSucceeded",
    ).mockRejectedValueOnce(new Error("ack unknown"));
    const effect = async () => {
      await model.beginTransition(current, {
        ...transition(),
        operationId: request.operationId,
      });
      effects.push(request.operationId);
      return { details: {}, effectiveAt: new Date() };
    };
    await expect(executeOperatorAction(request, effect)).rejects.toMatchObject({
      status: 502,
    });
    await expect(executeOperatorAction(request, effect)).rejects.toMatchObject({
      status: 409,
    });
    expect(effects).toEqual([request.operationId]);
    expect((await model.get(current._id))?.domainTransition?.operationId).toBe(
      request.operationId,
    );
  });
});
