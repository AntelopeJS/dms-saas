import { beforeEach, describe, expect, it, vi } from "vitest";

const dependencies = vi.hoisted(() => ({
  notify: vi.fn(),
  create: vi.fn(async () => ({ _id: "ticket-a" })),
  reply: vi.fn(async () => ({ _id: "message-a" })),
}));

vi.mock("@antelopejs/interface-dms/request-tenant", () => ({
  getRequestTenantId: () => "tenant-a",
}));

vi.mock("../src/notifications", async () => ({
  ...(await vi.importActual("../src/notifications")),
  notifyAllPlatformOwners: dependencies.notify,
}));

vi.mock("../src/support", async () => ({
  ...(await vi.importActual("../src/support")),
  createSupportTicket: dependencies.create,
  addSupportMessage: dependencies.reply,
  resolveTenantSupportPolicy: async () => ({ priorities: ["normal"] }),
}));

import { SaasTenantSupportController } from "../src/routes/tenant/support";

const user = { _id: "customer", name: "Customer" } as never;
const model = {} as never;
const context = {} as never;
const input = {
  requestId: "navigation-request-1",
  subject: "Question",
  category: "question",
  priority: "normal",
  body: "Help please",
  attachments: [],
};
const INBOX_PATH = "/modules/saas/support/support";

beforeEach(() => vi.clearAllMocks());

describe("support notification navigation", () => {
  it("links new tickets to the inbox page rather than its category", async () => {
    const controller = new SaasTenantSupportController();
    controller.tenantModel = {
      get: async () => ({ _id: "tenant-a", name: "Tenant" }),
    } as never;
    await controller.create(user, context, input, model, model, model, model);
    expect(dependencies.notify).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ linkTo: INBOX_PATH }),
    );
  });

  it("links customer replies to the same inbox page", async () => {
    await new SaasTenantSupportController().reply(
      user,
      context,
      "ticket-a",
      input,
      model,
      model,
      model,
    );
    expect(dependencies.notify).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ linkTo: INBOX_PATH }),
      "customer",
    );
  });
});
