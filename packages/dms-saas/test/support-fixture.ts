import { randomUUID } from "node:crypto";
import {
  GetModel,
  RegisterSchema,
} from "@antelopejs/interface-database-decorators";
import { construct, destroy } from "@antelopejs/mongodb";
import { MongoMemoryReplSet } from "mongodb-memory-server-core";
import { afterAll, afterEach, beforeAll, vi } from "vitest";
import { setRuntimeConfig } from "../src/config";
import {
  SupportMessageModel,
  SupportTicketEventModel,
  SupportTicketModel,
} from "../src/db";
import type {
  AddSupportMessageOptions,
  CreateSupportTicketOptions,
  SupportModels,
  UpdateSupportTicketOptions,
} from "../src/support/service";
import { createSupportTicket } from "../src/support/service";

const STARTUP_TIMEOUT_MS = 120_000;
let replica: MongoMemoryReplSet;

export function selectSupportStorage(storage = "support-primary"): void {
  setRuntimeConfig({
    supportStorage: storage,
    stripe: {
      secretKey: "test",
      webhookSecret: "test",
      publishableKey: "test",
    },
  });
}

beforeAll(async () => {
  replica = await MongoMemoryReplSet.create({
    binary: { version: "8.0.8" },
    replSet: { count: 1 },
  });
  await construct({ url: replica.getUri(), database: "support_receipts" });
  await RegisterSchema("dms-tenant");
  await RegisterSchema("dms-core");
}, STARTUP_TIMEOUT_MS);

afterEach(() => vi.restoreAllMocks());
afterAll(async () => {
  await destroy();
  await replica?.stop();
});

export function supportModels(): SupportModels {
  const tenantId = randomUUID();
  return {
    tickets: GetModel(SupportTicketModel, tenantId),
    messages: GetModel(SupportMessageModel, tenantId),
    events: GetModel(SupportTicketEventModel, tenantId),
  };
}

export function createOptions(
  models: SupportModels,
): CreateSupportTicketOptions {
  return {
    models,
    tenant: { _id: "tenant-a" } as never,
    authorId: "customer",
    requestId: randomUUID(),
    input: {
      subject: "Support",
      category: "incident",
      priority: "high",
      body: "Initial",
      attachments: [],
    },
  };
}

export function replyOptions(
  models: SupportModels,
  ticketId: string,
): AddSupportMessageOptions {
  return {
    models,
    tenantId: "tenant-a",
    ticketId,
    authorId: "owner",
    authorName: "Owner",
    authorType: "platform",
    requestId: randomUUID(),
    input: { body: "Reply", attachments: [] },
  };
}

export function updateOptions(
  models: SupportModels,
  ticketId: string,
): UpdateSupportTicketOptions {
  return {
    models,
    tenantId: "tenant-a",
    ticketId,
    actorId: "owner",
    actorName: "Owner",
    requestId: randomUUID(),
    input: { status: "in_progress", assignedTo: "owner" },
  };
}

export async function initialSupportTicket(models: SupportModels) {
  return createSupportTicket(createOptions(models));
}
