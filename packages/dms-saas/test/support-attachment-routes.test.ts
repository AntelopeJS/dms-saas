import { beforeEach, describe, expect, it, vi } from "vitest";

const dependencies = vi.hoisted(() => ({
  hasAttachment: vi.fn(),
  resolveUpload: vi.fn(),
  read: vi.fn(),
  presign: vi.fn(),
}));
vi.mock("@antelopejs/interface-dms/request-tenant", () => ({
  getRequestTenantId: () => "tenant-a",
}));
vi.mock("../src/support", async () => ({
  ...(await vi.importActual("../src/support")),
  reconcileSupportTicket: async () => ({ _id: "ticket-a" }),
  getSupportAttachmentMetadata: dependencies.read,
}));
vi.mock("../src/support/uploads", async () => ({
  ...(await vi.importActual("../src/support/uploads")),
  getSupportUpload: dependencies.resolveUpload,
  createSupportUpload: dependencies.presign,
}));
import { SaasTenantSupportController } from "../src/routes/tenant/support";

const user = {} as never;
const context = {} as never;
const tickets = {} as never;
const messages = { hasAttachment: dependencies.hasAttachment } as never;
const key = "support-attachments/tenant-a/file.txt";
beforeEach(() => {
  vi.clearAllMocks();
  dependencies.resolveUpload.mockResolvedValue({ storage: "historical-store" });
  dependencies.hasAttachment.mockResolvedValue(true);
});

describe("support tenant route business authorization after membership guard", () => {
  it("does not resolve storage or issue reads for an unattached key", async () => {
    dependencies.hasAttachment.mockResolvedValueOnce(false);
    await expect(
      new SaasTenantSupportController().attachment(
        user,
        context,
        "ticket-a",
        key,
        tickets,
        messages,
      ),
    ).rejects.toMatchObject({ status: 404 });
    expect(dependencies.resolveUpload).not.toHaveBeenCalled();
    expect(dependencies.read).not.toHaveBeenCalled();
  });

  it("reads an attached key using only its persisted tenant routing", async () => {
    await new SaasTenantSupportController().attachment(
      user,
      context,
      "ticket-a",
      key,
      tickets,
      messages,
    );
    expect(dependencies.hasAttachment).toHaveBeenCalledWith("ticket-a", key);
    expect(dependencies.resolveUpload).toHaveBeenCalledWith(
      "tenant-a",
      `__staging__/${key}`,
    );
    expect(dependencies.read).toHaveBeenCalledWith(key, "historical-store");
  });

  it("rejects missing issuance provenance without falling back to configuration", async () => {
    dependencies.resolveUpload.mockRejectedValueOnce(new Error("unissued"));
    await expect(
      new SaasTenantSupportController().attachment(
        user,
        context,
        "ticket-a",
        key,
        tickets,
        messages,
      ),
    ).rejects.toThrow("unissued");
    expect(dependencies.read).not.toHaveBeenCalled();
  });
});
