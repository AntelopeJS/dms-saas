import { randomUUID } from "node:crypto";
import { GetModel } from "@antelopejs/interface-database-decorators";
import { DEFAULT_TENANT_ID } from "@antelopejs/interface-dms/constants";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { registerAutomationNodes } from "../src/automation";
import { PlatformNoteModel } from "../src/db";
import "../src/routes/platformOwner/platform-notes";
import { ANY_STRING } from "./helpers/asymmetric-matchers";
import {
  executionCtx,
  implementAutomationCatalog,
  registeredAction,
} from "./helpers/automation";
import { createUser, tenantRequest, useDmsAuth } from "./helpers/dms";
import { useMongoDatabase } from "./helpers/mongo";
import { callRoute } from "./helpers/routes";
import { insertTenant } from "./helpers/workspaces";

useMongoDatabase();
useDmsAuth();
const automation = implementAutomationCatalog();
await registerAutomationNodes();
const addNote = registeredAction(automation, "saas.add-platform-note");

const NOTES_ROUTE = "/api/saas/platform-notes/:targetType/:targetId";

async function workspace(): Promise<string> {
  const tenantId = randomUUID();
  await insertTenant(tenantId);
  return tenantId;
}

async function notesOf(targetId: string) {
  return GetModel(PlatformNoteModel)
    .table.filter((row) => row.key("targetId").eq(targetId))
    .run();
}

const listedNotes = z.object({
  items: z.array(
    z.object({
      authorKind: z.string(),
      authorName: z.string().nullable(),
      content: z.string(),
    }),
  ),
});

/** The notes of a workspace as the operator's notes panel lists them. */
async function listAsOperator(targetId: string) {
  const owner = await createUser({ owner: true });
  const request = await tenantRequest(owner, DEFAULT_TENANT_ID);
  const listed: unknown = await callRoute(
    "GET",
    NOTES_ROUTE,
    Object.assign(request, {
      routeParameters: { targetType: "workspace", targetId },
      url: new URL(
        `https://example.test/api/saas/platform-notes/workspace/${targetId}`,
      ),
    }),
  );
  return listedNotes.parse(listed).items;
}

describe("saas.add-platform-note", () => {
  it("writes one note authored by the procedure", async () => {
    const tenantId = await workspace();

    const output = await addNote.execute(
      { targetId: tenantId, content: "  Renewal call booked  " },
      executionCtx({ procedureId: "procedure-notes" }),
    );

    expect(output).toEqual({ noteId: ANY_STRING, created: true });
    expect(await notesOf(tenantId)).toEqual([
      expect.objectContaining({
        targetType: "workspace",
        authorId: "automation:procedure-notes",
        content: "Renewal call booked",
      }),
    ]);
  });

  it("writes no second note when the step runs again", async () => {
    const tenantId = await workspace();
    const ctx = executionCtx();
    const input = { targetId: tenantId, content: "Renewal call booked" };

    const first = await addNote.execute(input, ctx);
    const retried = await addNote.execute(input, ctx);

    expect(retried).toEqual({ noteId: first?.noteId, created: false });
    expect(await notesOf(tenantId)).toHaveLength(1);
  });

  it("writes a note on each target a for-each loop hands the step with one key", async () => {
    const first = await workspace();
    const second = await workspace();
    const ctx = executionCtx();

    await addNote.execute(
      { targetId: first, content: "Churn risk", idempotencyKey: "evt_1" },
      ctx,
    );
    await addNote.execute(
      { targetId: second, content: "Churn risk", idempotencyKey: "evt_1" },
      ctx,
    );

    expect(await notesOf(first)).toHaveLength(1);
    expect(await notesOf(second)).toHaveLength(1);
  });

  it("writes a note about a user", async () => {
    const user = await createUser();

    await addNote.execute(
      { targetType: "user", targetId: user._id, content: "VIP" },
      executionCtx(),
    );

    expect(await notesOf(user._id)).toEqual([
      expect.objectContaining({ targetType: "user" }),
    ]);
  });

  it.each([
    [
      "an unknown target",
      { targetId: "no-such-workspace", content: "x" },
      "target_not_found",
    ],
    [
      "empty content",
      { targetId: "", content: "   " },
      "saas.add-platform-note:",
    ],
    [
      "content over 4000 characters",
      { targetId: "x", content: "x".repeat(4001) },
      "content",
    ],
  ])("refuses %s", async (_case, input, message) => {
    await expect(addNote.execute(input, executionCtx())).rejects.toThrow(
      message,
    );
  });

  it("writes nothing in a test run and answers the id it would use", async () => {
    const tenantId = await workspace();
    const ctx = executionCtx({ dryRun: true });
    const input = { targetId: tenantId, content: "Trial review" };

    const simulated = await addNote.dryRun?.(input, ctx);

    expect(simulated).toEqual({ noteId: ANY_STRING, created: true });
    expect(await notesOf(tenantId)).toEqual([]);
    const executed = await addNote.execute(input, ctx);
    expect(executed?.noteId).toBe(simulated?.noteId);
  });

  it("is listed to operators as written by automation", async () => {
    const tenantId = await workspace();
    await addNote.execute(
      { targetId: tenantId, content: "Written by a procedure" },
      executionCtx(),
    );

    await expect(listAsOperator(tenantId)).resolves.toEqual([
      {
        authorKind: "automation",
        authorName: null,
        content: "Written by a procedure",
      },
    ]);
  });

  it("leaves a note an operator writes attributed to them", async () => {
    const tenantId = await workspace();
    const operator = await createUser({ owner: true, name: "Olivia Operator" });
    const request = await tenantRequest(operator, DEFAULT_TENANT_ID);

    const created: unknown = await callRoute(
      "POST",
      NOTES_ROUTE,
      Object.assign(request, {
        routeParameters: { targetType: "workspace", targetId: tenantId },
        url: new URL(
          `https://example.test/api/saas/platform-notes/workspace/${tenantId}`,
        ),
        body: Promise.resolve(
          Buffer.from(JSON.stringify({ content: "Called the owner" })),
        ),
      }),
    );

    expect(created).toMatchObject({
      authorId: operator._id,
      authorKind: "user",
      authorName: "Olivia Operator",
      content: "Called the owner",
    });
  });
});
