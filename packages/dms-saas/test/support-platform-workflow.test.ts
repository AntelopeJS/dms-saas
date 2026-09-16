import type { HTTPResult } from "@antelopejs/interface-api";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupportMessage, SupportTicket } from "../src/db";
import type { UpdateSupportTicketOptions } from "../src/support/service";

const dependencies = vi.hoisted(() => ({
  addMessage: vi.fn(),
  updateTicket: vi.fn(),
  getModel: vi.fn(),
  notifyTenant: vi.fn(),
}));

vi.mock("@antelopejs/interface-database-decorators", async () => {
  const actual = await vi.importActual<
    typeof import("@antelopejs/interface-database-decorators")
  >("@antelopejs/interface-database-decorators");
  return { ...actual, GetModel: dependencies.getModel };
});

vi.mock("../src/notifications", async () => {
  const actual = await vi.importActual<typeof import("../src/notifications")>(
    "../src/notifications",
  );
  return { ...actual, notifyTenantMembers: dependencies.notifyTenant };
});

vi.mock("../src/support", async () => {
  const actual =
    await vi.importActual<typeof import("../src/support")>("../src/support");
  return {
    ...actual,
    addSupportMessage: dependencies.addMessage,
    updateSupportTicket: dependencies.updateTicket,
  };
});

import { SaasPlatformSupportController } from "../src/routes/platformOwner/support";

interface PlatformMocks {
  controller: SaasPlatformSupportController;
  ticket: SupportTicket;
  tickets: Record<string, ReturnType<typeof vi.fn>>;
  messages: Record<string, ReturnType<typeof vi.fn>>;
  events: Record<string, ReturnType<typeof vi.fn>>;
}

interface NamedModel {
  name: string;
}

function platformMocks(): PlatformMocks {
  const now = new Date("2026-09-03T00:00:00.000Z");
  const ticket = {
    _id: "ticket-1",
    subject: "Production issue",
    category: "incident",
    priority: "high",
    status: "open",
    createdBy: "customer",
    assignedTo: null,
    revision: 0,
    mutationId: "initial",
    lastMessageAt: now,
    createdAt: now,
    updatedAt: now,
  } as SupportTicket;
  const tickets = {
    get: vi.fn(async () => ticket),
  };
  const messages = {};
  const events = { insert: vi.fn() };
  dependencies.getModel.mockImplementation(
    (model: NamedModel, tenantId?: string) => {
      expect(tenantId).toBe("tenant-a");
      return {
        SupportTicketModel: tickets,
        SupportMessageModel: messages,
        SupportTicketEventModel: events,
      }[model.name];
    },
  );
  const controller = new SaasPlatformSupportController();
  controller.tenantModel = {
    get: vi.fn(async () => ({ _id: "tenant-a", name: "Acme" })),
  } as never;
  controller.userModel = { get: vi.fn() } as never;
  return { controller, ticket, tickets, messages, events };
}

beforeEach(() => vi.clearAllMocks());

describe("platform support workflow", () => {
  it("returns the scoped ticket and tenant identity for detail", async () => {
    const { controller, ticket, tickets } = platformMocks();
    await expect(
      controller.detail({} as never, "tenant-a", "ticket-1"),
    ).resolves.toMatchObject({
      ticket,
      tenantId: "tenant-a",
      tenantName: "Acme",
    });
    expect(tickets.get).toHaveBeenCalledWith("ticket-1");
  });

  it("returns not found for a missing scoped ticket", async () => {
    const { controller, tickets } = platformMocks();
    tickets.get.mockResolvedValueOnce(undefined);
    await expect(
      controller.detail({} as never, "tenant-a", "missing"),
    ).rejects.toMatchObject<Partial<HTTPResult>>({ status: 404 });
  });

  it("passes scoped operator intent and stable request identity to the service and notifies", async () => {
    const { controller, ticket } = platformMocks();
    const updated = { ...ticket, status: "in_progress" };
    dependencies.updateTicket.mockResolvedValue(updated);
    controller.userModel = {
      get: vi.fn(async () => ({ _id: "owner-1", owner: true })),
    } as never;
    await expect(
      controller.update(
        { _id: "actor", name: "Ada" } as never,
        "tenant-a",
        "ticket-1",
        {
          requestId: "platform-update-request",
          assignedTo: "owner-1",
          status: "in_progress",
        },
      ),
    ).resolves.toEqual(updated);
    expect(dependencies.updateTicket).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "tenant-a",
        ticketId: "ticket-1",
        requestId: "platform-update-request",
        actorId: "actor",
        actorName: "Ada",
        input: { status: "in_progress", assignedTo: "owner-1" },
      }),
    );
    expect(dependencies.notifyTenant).toHaveBeenCalledWith(
      "tenant-a",
      expect.objectContaining({ id: "saas.support_status_changed" }),
      expect.anything(),
    );
  });

  it("rejects assignment to a non-owner before writing", async () => {
    const { controller, events } = platformMocks();
    controller.userModel = {
      get: vi.fn(async () => ({ _id: "member", owner: false })),
    } as never;
    dependencies.updateTicket.mockImplementationOnce(
      async (options: UpdateSupportTicketOptions) =>
        options.validateNewRequest?.(),
    );
    await expect(
      controller.update({} as never, "tenant-a", "ticket-1", {
        requestId: "invalid-assignment-request",
        assignedTo: "member",
      }),
    ).rejects.toMatchObject<Partial<HTTPResult>>({ status: 400 });
    expect(controller.userModel.get).toHaveBeenCalledWith("member");
    expect(events.insert).not.toHaveBeenCalled();
  });

  it("stores a platform reply in the selected tenant and notifies members", async () => {
    const { controller } = platformMocks();
    const message = {
      _id: "message-2",
      ticketId: "ticket-1",
      authorId: "owner-1",
      authorType: "platform",
      body: "Fixed",
      attachments: [],
      createdAt: new Date(),
    } as SupportMessage;
    dependencies.addMessage.mockResolvedValue(message);
    await expect(
      controller.reply(
        { _id: "owner-1", name: "Ada" } as never,
        "tenant-a",
        "ticket-1",
        { requestId: "platform-reply-request", body: "Fixed", attachments: [] },
      ),
    ).resolves.toBe(message);
    expect(dependencies.addMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "tenant-a",
        ticketId: "ticket-1",
        authorName: "Ada",
        authorType: "platform",
        models: expect.objectContaining({
          tickets: expect.anything(),
          messages: expect.anything(),
          events: expect.anything(),
        }),
      }),
    );
    expect(dependencies.notifyTenant).toHaveBeenCalled();
  });

  it("rejects platform attachment injection before writing", async () => {
    const { controller } = platformMocks();
    await expect(
      controller.reply({ _id: "owner" } as never, "tenant-a", "ticket-1", {
        body: "Reply",
        attachments: ["__staging__/support-attachments/tenant-a/file"],
      }),
    ).rejects.toMatchObject<Partial<HTTPResult>>({ status: 400 });
    expect(dependencies.addMessage).not.toHaveBeenCalled();
  });
});
