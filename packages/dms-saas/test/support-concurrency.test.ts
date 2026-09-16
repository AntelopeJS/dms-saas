import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  SupportOperationModel,
  supportOperationId,
} from "../src/support/operations";
import { reconcileSupportTicket } from "../src/support/publications";
import {
  addSupportMessage,
  createSupportTicket,
  updateSupportTicket,
} from "../src/support/service";
import {
  createOptions,
  initialSupportTicket,
  replyOptions,
  supportModels,
  updateOptions,
} from "./support-fixture";

const CONTENDERS = 12;

describe("durable support publications on actual Mongo", () => {
  it("admits one competing publication and permits fresh intent after known conflict", async () => {
    const models = supportModels();
    const ticket = await initialSupportTicket(models);
    const publish = models.tickets.publish.bind(models.tickets);
    const ready = Promise.withResolvers<void>();
    let arrivals = 0;
    const gate = vi
      .spyOn(models.tickets, "publish")
      .mockImplementation(async (...args) => {
        arrivals += 1;
        if (arrivals === CONTENDERS) ready.resolve();
        await ready.promise;
        return publish(...args);
      });
    const results = await Promise.allSettled(
      Array.from({ length: CONTENDERS }, () =>
        updateSupportTicket(updateOptions(models, ticket._id)),
      ),
    );
    gate.mockRestore();
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    for (const result of results) {
      if (result.status === "rejected")
        expect(result.reason).toMatchObject({ status: 409 });
    }
    expect(await models.events.getAll()).toHaveLength(2);
    const retry = updateOptions(models, ticket._id);
    retry.input.status = "resolved";
    await updateSupportTicket(retry);
    expect(await models.tickets.get(ticket._id)).toMatchObject({
      revision: 2,
      status: "resolved",
      publicationId: null,
    });
    expect(await models.events.getAll()).toHaveLength(3);
  });

  it("returns one creation and one reply across concurrent identical transport retries", async () => {
    const models = supportModels();
    const create = createOptions(models);
    const tickets = await Promise.all(
      Array.from({ length: CONTENDERS }, () => createSupportTicket(create)),
    );
    expect(new Set(tickets.map((ticket) => ticket._id)).size).toBe(1);
    const reply = replyOptions(models, tickets[0]._id);
    const messages = await Promise.all(
      Array.from({ length: CONTENDERS }, () => addSupportMessage(reply)),
    );
    expect(new Set(messages.map((message) => message._id)).size).toBe(1);
    expect(await models.tickets.getAll()).toHaveLength(1);
    expect(await models.messages.getAll()).toHaveLength(2);
    expect(await models.events.getAll()).toHaveLength(1);
  });

  it("rejects request ID reuse with changed intent and keeps the original result", async () => {
    const models = supportModels();
    const create = createOptions(models);
    const original = await createSupportTicket(create);
    await expect(
      createSupportTicket({
        ...create,
        input: { ...create.input, body: "different" },
      }),
    ).rejects.toMatchObject({
      status: 409,
      body: "saas.errors.support.request_reused",
    });
    expect(await createSupportTicket(create)).toEqual(original);
    expect(await models.messages.getAll()).toHaveLength(1);
  });

  it("repairs a crash between ticket commit and message projection on read", async () => {
    const models = supportModels();
    const ticket = await initialSupportTicket(models);
    const request = replyOptions(models, ticket._id);
    vi.spyOn(models.messages, "insert").mockRejectedValueOnce(
      new Error("process interrupted"),
    );
    await expect(addSupportMessage(request)).rejects.toMatchObject({
      status: 503,
    });
    expect(await models.tickets.get(ticket._id)).toMatchObject({
      status: "waiting_customer",
      revision: 1,
    });
    await reconcileSupportTicket(models.tickets, ticket._id);
    const retried = await addSupportMessage(request);
    expect(
      (await models.messages.getAll()).map((message) => message._id),
    ).toContain(retried._id);
    expect(await models.messages.getAll()).toHaveLength(2);
    expect(await models.events.getAll()).toHaveLength(1);
  });

  it("repairs a partial audit insert without duplicating events or changing actor history", async () => {
    const models = supportModels();
    const ticket = await initialSupportTicket(models);
    const request = updateOptions(models, ticket._id);
    const insert = models.events.insert.bind(models.events);
    vi.spyOn(models.events, "insert").mockImplementationOnce(async (rows) => {
      await insert(rows);
      throw new Error("audit ack lost");
    });
    await updateSupportTicket(request);
    await updateSupportTicket(request);
    expect(await models.events.getAll()).toMatchObject([
      { actorId: "owner", previousValue: "open", newValue: "in_progress" },
      { actorId: "owner", previousValue: null, newValue: "owner" },
    ]);
  });

  it("retains the receipt before later writes can erase ambiguous commit evidence", async () => {
    const models = supportModels();
    const ticket = await initialSupportTicket(models);
    const request = replyOptions(models, ticket._id);
    const publish = models.tickets.publish.bind(models.tickets);
    vi.spyOn(models.tickets, "publish").mockImplementationOnce(
      async (...args) => {
        await publish(...args);
        const newer = updateOptions(models, ticket._id);
        newer.input.status = "resolved";
        await updateSupportTicket(newer);
        return "unknown";
      },
    );
    const message = await addSupportMessage(request);
    expect(await addSupportMessage(request)).toEqual(message);
    expect(await models.tickets.get(ticket._id)).toMatchObject({
      revision: 2,
      status: "resolved",
    });
    expect(await models.messages.getAll()).toHaveLength(2);
    expect(await models.events.getAll()).toHaveLength(3);
  });

  it("replays the same prepared operation after an unknown result with no applied write", async () => {
    const models = supportModels();
    const ticket = await initialSupportTicket(models);
    const request = replyOptions(models, ticket._id);
    vi.spyOn(models.tickets, "publish").mockResolvedValueOnce("unknown");
    await expect(addSupportMessage(request)).rejects.toMatchObject({
      status: 503,
    });
    expect(await models.messages.getAll()).toHaveLength(1);
    await addSupportMessage(request);
    expect(await models.messages.getAll()).toHaveLength(2);
    expect(await models.tickets.get(ticket._id)).toMatchObject({ revision: 1 });
  });

  it("preserves published evidence when receipt finalization fails, then another writer helps", async () => {
    const models = supportModels();
    const ticket = await initialSupportTicket(models);
    const request = replyOptions(models, ticket._id);
    const finish = SupportOperationModel.prototype.finish;
    vi.spyOn(SupportOperationModel.prototype, "finish")
      .mockImplementationOnce(function (operation, status, failure) {
        return finish.call(this, operation, status, failure);
      })
      .mockRejectedValueOnce(new Error("receipt unavailable"));
    await expect(addSupportMessage(request)).rejects.toThrow(
      "receipt unavailable",
    );
    expect((await models.tickets.get(ticket._id))?.publicationId).toBe(
      supportOperationId("tenant-a", "owner", request.requestId),
    );
    const next = updateOptions(models, ticket._id);
    next.input.status = "resolved";
    await updateSupportTicket(next);
    await addSupportMessage(request);
    expect(await models.messages.getAll()).toHaveLength(2);
  });

  it("fences a delayed completion from clearing a newer ticket publication", async () => {
    const models = supportModels();
    const ticket = await initialSupportTicket(models);
    const request = replyOptions(models, ticket._id);
    await addSupportMessage(request);
    const old = supportOperationId("tenant-a", "owner", request.requestId);
    const next = updateOptions(models, ticket._id);
    next.input.status = "resolved";
    await updateSupportTicket(next);
    expect(await models.tickets.settlePublication(ticket._id, old)).toBe(
      "not-applied",
    );
    expect(await models.tickets.get(ticket._id)).toMatchObject({
      status: "resolved",
      revision: 2,
    });
  });

  it("does not change revisions or audit history for unchanged operator intent", async () => {
    const models = supportModels();
    const ticket = await initialSupportTicket(models);
    const options = updateOptions(models, ticket._id);
    options.input = { status: "open", assignedTo: null };
    expect(await updateSupportTicket(options)).toMatchObject(ticket);
    expect(await models.tickets.get(ticket._id)).toMatchObject(ticket);
    expect(await models.events.getAll()).toHaveLength(0);
  });

  it("replays captured intent without reevaluating mutable policy", async () => {
    const models = supportModels();
    const create = createOptions(models);
    const validateNewRequest = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValue(new Error("policy changed"));
    const options = { ...create, validateNewRequest };
    const ticket = await createSupportTicket(options);
    expect(await createSupportTicket(options)).toEqual(ticket);
    expect(validateNewRequest).toHaveBeenCalledTimes(1);
    await expect(
      createSupportTicket({ ...options, requestId: randomUUID() }),
    ).rejects.toThrow("policy changed");
    expect(await models.tickets.getAll()).toHaveLength(1);
  });

  it("rejects missing request identity instead of generating a duplicate-prone fallback", async () => {
    const options = createOptions(supportModels());
    options.requestId = "";
    await expect(createSupportTicket(options)).rejects.toMatchObject({
      status: 400,
    });
    options.requestId = randomUUID();
    await createSupportTicket(options);
  });
});
