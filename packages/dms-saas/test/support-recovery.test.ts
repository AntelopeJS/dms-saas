import { describe, expect, it, vi } from "vitest";
import { SupportOperationModel } from "../src/support/operations";
import { createSupportPlan } from "../src/support/plans";
import { recoverSupportOperations } from "../src/support/recovery";
import { createSupportTicket } from "../src/support/service";
import { createOptions, supportModels } from "./support-fixture";

describe("persisted support recovery on real Mongo", () => {
  it("finishes an abandoned prepared request without resubmitting its body", async () => {
    const models = supportModels();
    vi.spyOn(SupportOperationModel.prototype, "finish").mockRejectedValueOnce(
      new Error("interrupted"),
    );
    const request = createOptions(models);
    await expect(createSupportTicket(request)).rejects.toThrow("interrupted");
    expect(await models.tickets.getAll()).toHaveLength(0);
    expect(await recoverSupportOperations("tenant-a", models)).toMatchObject({
      pending: [],
      nextCursor: null,
    });
    expect(await models.messages.getAll()).toHaveLength(1);
    const ticket = await createSupportTicket(request);
    expect((await models.tickets.getAll()).map((row) => row._id)).toEqual([
      ticket._id,
    ]);
  });

  it("repairs a committed receipt whose ticket settlement was interrupted", async () => {
    const models = supportModels();
    vi.spyOn(models.tickets, "settlePublication").mockRejectedValueOnce(
      new Error("interrupted"),
    );
    await expect(createSupportTicket(createOptions(models))).rejects.toThrow(
      "interrupted",
    );
    expect((await models.tickets.getAll())[0].publicationId).toBeTruthy();
    expect(
      (await recoverSupportOperations("tenant-a", models)).pending,
    ).toEqual([]);
    expect((await models.tickets.getAll())[0].publicationId).toBeNull();
    expect(await models.messages.getAll()).toHaveLength(1);
  });

  it("bounds each page and advances past a failing receipt without touching another tenant", async () => {
    const models = supportModels();
    const other = supportModels();
    const operations = new SupportOperationModel(models.tickets.database);
    for (let index = 1; index <= 21; index += 1) {
      const id = index.toString(16).padStart(64, "0");
      await operations.prepare({
        _id: id,
        revision: `${id}:prepared`,
        status: "prepared",
        kind: "create",
        fingerprint: id,
        payload: JSON.stringify(createSupportPlan(createOptions(models), id)),
      });
    }
    vi.spyOn(models.tickets, "insert").mockRejectedValueOnce(
      new Error("unavailable"),
    );
    const first = await recoverSupportOperations("tenant-a", models);
    expect(first.processed).toHaveLength(19);
    expect(first.pending).toEqual(["1".padStart(64, "0")]);
    expect(first.nextCursor).toBe("14".padStart(64, "0"));
    const last = await recoverSupportOperations(
      "tenant-a",
      models,
      first.nextCursor!,
    );
    expect(last.processed).toEqual(["15".padStart(64, "0")]);
    expect(last.nextCursor).toBeNull();
    expect(await other.tickets.getAll()).toHaveLength(0);
    expect(
      (await recoverSupportOperations("tenant-a", models)).pending,
    ).toEqual([]);
    expect(await models.tickets.getAll()).toHaveLength(21);
  });
});
