import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { registerAutomationNodes } from "../src/automation";
import { ANY_STRING } from "./helpers/asymmetric-matchers";
import {
  executionCtx,
  implementAutomationCatalog,
  registeredAction,
} from "./helpers/automation";
import { addTenantMember, createUser } from "./helpers/dms";
import { useMongoDatabase } from "./helpers/mongo";
import { implementNotificationCore } from "./helpers/notification-core";
import { insertTenant } from "./helpers/workspaces";

useMongoDatabase();
const core = implementNotificationCore();
const automation = implementAutomationCatalog();
await registerAutomationNodes();
const notifyOwners = registeredAction(automation, "saas.notify-tenant-owners");

interface OwnedWorkspace {
  tenantId: string;
  ownerIds: string[];
}

async function workspaceWithOwners(owners = 2): Promise<OwnedWorkspace> {
  const tenantId = randomUUID();
  await insertTenant(tenantId);
  const ownerIds: string[] = [];
  for (let index = 0; index < owners; index += 1) {
    const owner = await createUser();
    await addTenantMember(tenantId, owner, true);
    ownerIds.push(owner._id);
  }
  await addTenantMember(tenantId, await createUser());
  return { tenantId, ownerIds };
}

function notification(tenantId: string, title = "Renewal soon") {
  return { tenantId, title, description: "Your plan renews in 3 days" };
}

/** The recipients and event key of every send the core received. */
function sends() {
  return core.sendToUsers.mock.calls.map(([userIds, , , eventId]) => ({
    userIds: [...userIds].sort(),
    eventId,
  }));
}

describe("saas.notify-tenant-owners", () => {
  it("notifies every owner and no plain member", async () => {
    const workspace = await workspaceWithOwners();

    const output = await notifyOwners.execute(
      notification(workspace.tenantId),
      executionCtx(),
    );

    expect(output).toEqual({ ok: true, recipientCount: 2 });
    expect(sends()).toEqual([
      { userIds: [...workspace.ownerIds].sort(), eventId: ANY_STRING },
    ]);
  });

  it("hands a retried step the same event key, which the core deduplicates", async () => {
    const workspace = await workspaceWithOwners(1);
    const ctx = executionCtx();

    await notifyOwners.execute(notification(workspace.tenantId), ctx);
    await notifyOwners.execute(notification(workspace.tenantId), ctx);

    const [first, retried] = sends();
    expect(retried?.eventId).toBe(first?.eventId);
  });

  it("keys a wired idempotency key per procedure, node and workspace", async () => {
    const workspace = await workspaceWithOwners(1);

    await notifyOwners.execute(
      { ...notification(workspace.tenantId), idempotencyKey: "evt_1" },
      executionCtx({ procedureId: "procedure-a", nodeId: "node-a" }),
    );

    expect(sends()[0]?.eventId).toBe(
      `saas.notify-tenant-owners:procedure-a:node-a:${workspace.tenantId}:evt_1`,
    );
  });

  it("notifies an owner of two workspaces once per workspace under one key", async () => {
    const owner = await createUser();
    const tenantIds = [randomUUID(), randomUUID()];
    for (const tenantId of tenantIds) {
      await insertTenant(tenantId);
      await addTenantMember(tenantId, owner, true);
    }
    const ctx = executionCtx();

    for (const tenantId of tenantIds)
      await notifyOwners.execute(
        { ...notification(tenantId), idempotencyKey: "evt_shared" },
        ctx,
      );

    const [first, second] = sends();
    expect([first?.userIds, second?.userIds]).toEqual([
      [owner._id],
      [owner._id],
    ]);
    expect(second?.eventId).not.toBe(first?.eventId);
  });

  it("notifies each workspace a for-each loop hands the same step", async () => {
    const first = await workspaceWithOwners(1);
    const second = await workspaceWithOwners(1);
    const ctx = executionCtx();

    await notifyOwners.execute(notification(first.tenantId), ctx);
    await notifyOwners.execute(notification(second.tenantId), ctx);

    const [toFirst, toSecond] = sends();
    expect(toFirst?.userIds).toEqual(first.ownerIds);
    expect(toSecond?.userIds).toEqual(second.ownerIds);
    expect(toSecond?.eventId).not.toBe(toFirst?.eventId);
  });

  it("fails the step when the notification is not stored", async () => {
    const workspace = await workspaceWithOwners(1);
    core.sendToUsers.mockRejectedValue(new Error("storage unavailable"));

    await expect(
      notifyOwners.execute(notification(workspace.tenantId), executionCtx()),
    ).rejects.toThrow("storage unavailable");
  });

  it.each([
    ["an empty title", ""],
    ["a title over 200 characters", "x".repeat(201)],
  ])("refuses %s", async (_case, title) => {
    const workspace = await workspaceWithOwners(1);

    await expect(
      notifyOwners.execute(
        notification(workspace.tenantId, title),
        executionCtx(),
      ),
    ).rejects.toThrow("saas.notify-tenant-owners: title");
    expect(sends()).toEqual([]);
  });

  it("refuses an unknown workspace", async () => {
    await expect(
      notifyOwners.execute(notification("no-such-workspace"), executionCtx()),
    ).rejects.toThrow('unknown workspace "no-such-workspace"');
  });
});

describe("saas.notify-tenant-owners test runs", () => {
  it("sends nothing and counts the owners", async () => {
    const workspace = await workspaceWithOwners(3);

    const output = await notifyOwners.dryRun?.(
      notification(workspace.tenantId),
      executionCtx({ dryRun: true }),
    );

    expect(output).toEqual({ ok: true, recipientCount: 3 });
    expect(sends()).toEqual([]);
    expect(core.sendToUser).not.toHaveBeenCalled();
  });
});
