import { randomUUID } from "node:crypto";
import { GetModel } from "@antelopejs/interface-database-decorators";
import {
  FileConflictError,
  FileNotFoundError,
  stripStagingPrefix,
  type FileMetadata,
  type UploadRequest,
} from "@antelopejs/interface-file-storage";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SupportAttachmentAdmissionModel } from "../src/support/admissions";
import { SUPPORT_ATTACHMENT_MAX_SIZE } from "../src/support/config";
import { recoverSupportOperations } from "../src/support/recovery";
import { createSupportTicket } from "../src/support/service";
import {
  createSupportUpload,
  parseSupportUpload,
  SupportUploadModel,
} from "../src/support/uploads";
import {
  createOptions,
  selectSupportStorage,
  supportModels,
} from "./support-fixture";

const storage = vi.hoisted(() => ({
  files: new Map<string, FileMetadata>(),
  origins: new Map<string, string>(),
  presign: vi.fn(),
  promote: vi.fn(),
  metadata: vi.fn(),
  remove: vi.fn(),
  move: vi.fn(),
}));
vi.mock("@antelopejs/interface-file-storage", async () => ({
  ...(await vi.importActual("@antelopejs/interface-file-storage")),
  CreateUploadUrl: storage.presign,
  PromoteFile: storage.promote,
  GetFileMetadata: storage.metadata,
  DeleteFile: storage.remove,
  MoveFile: storage.move,
}));

const STORE = "support-primary";
function address(key: string, store = STORE): string {
  return `${store}:${key}`;
}
function promote(key: string, store: string) {
  const finalKey = stripStagingPrefix(key);
  const destination = address(finalKey, store);
  if (storage.files.has(destination)) {
    if (storage.origins.get(destination) !== key)
      throw new FileConflictError(finalKey);
    return { resourceKey: finalKey };
  }
  const source = storage.files.get(address(key, store));
  if (!source) throw new FileNotFoundError(key);
  storage.files.set(destination, { ...source, resourceKey: finalKey });
  storage.origins.set(destination, key);
  storage.files.delete(address(key, store));
  return { resourceKey: finalKey };
}

async function upload(tenantId = "tenant-a"): Promise<string> {
  return (
    await createSupportUpload(tenantId, {
      filename: "evidence.txt",
      size: 10,
      mimetype: "text/plain",
    })
  ).resourceKey;
}

beforeEach(() => {
  selectSupportStorage();
  storage.files.clear();
  storage.origins.clear();
  vi.clearAllMocks();
  storage.presign.mockImplementation(
    async (input: UploadRequest, _constraints: unknown, store: string) => {
      const resourceKey = `__staging__/${input.path}/${randomUUID()}.txt`;
      storage.files.set(address(resourceKey, store), {
        resourceKey,
        filename: input.filename,
        size: input.size,
        mimetype: input.mimetype,
        lastModified: Date.now(),
      });
      return {
        resourceKey,
        uploadUrl: "https://upload.test/put",
        headers: { "x-required": "signed" },
        expiresAt: Date.now(),
      };
    },
  );
  storage.promote.mockImplementation(async (key: string, store: string) =>
    promote(key, store),
  );
  storage.metadata.mockImplementation(async (key: string, store: string) => {
    const metadata = storage.files.get(address(key, store));
    if (!metadata) throw new FileNotFoundError(key);
    return metadata;
  });
  storage.remove.mockImplementation(async (key: string, store: string) => {
    storage.files.delete(address(key, store));
  });
});

describe("support business admissions on real Mongo with contract-mocked immutable storage", () => {
  it("server-binds private presign and persists routing before exposing required headers", async () => {
    const input = parseSupportUpload({
      filename: "safe.txt",
      size: 10,
      mimetype: "text/plain",
      storage: "public",
      visibility: "public",
      path: "other",
    });
    const response = await createSupportUpload("tenant-a", input);
    expect(response.headers).toEqual({ "x-required": "signed" });
    expect(storage.presign).toHaveBeenCalledWith(
      expect.objectContaining({
        visibility: "private",
        staging: true,
        path: "support-attachments/tenant-a",
      }),
      expect.anything(),
      STORE,
    );
    expect(
      await GetModel(SupportUploadModel).getBy(
        "stagedKey",
        response.resourceKey,
      ),
    ).toMatchObject([{ storage: STORE, tenantId: "tenant-a" }]);
  });

  it("rejects absent storage configuration without default fallback", async () => {
    selectSupportStorage("");
    await expect(upload()).rejects.toMatchObject({ status: 503 });
    expect(storage.presign).not.toHaveBeenCalled();
  });

  it("admits a reused source once and gives the losing request no deletion rights", async () => {
    const options = createOptions(supportModels());
    const key = await upload();
    options.input.attachments = [key];
    const results = await Promise.allSettled([
      createSupportTicket(options),
      createSupportTicket({ ...options, requestId: randomUUID() }),
    ]);
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      results.find((result) => result.status === "rejected"),
    ).toMatchObject({ reason: { status: 409 } });
    expect((await options.models.messages.getAll())[0].attachments).toEqual([
      stripStagingPrefix(key),
    ]);
    expect(storage.remove).not.toHaveBeenCalled();
    expect(storage.move).not.toHaveBeenCalled();
  });

  it("replays an unknown promotion through trusted origin after the source disappeared", async () => {
    const options = createOptions(supportModels());
    options.input.attachments = [await upload()];
    storage.promote.mockImplementationOnce(
      async (key: string, store: string) => {
        promote(key, store);
        throw new Error("ack unknown");
      },
    );
    await expect(createSupportTicket(options)).rejects.toThrow("ack unknown");
    expect(storage.remove).not.toHaveBeenCalled();
    const ticket = await createSupportTicket(options);
    expect(await createSupportTicket(options)).toEqual(ticket);
    expect(await options.models.messages.getAll()).toHaveLength(1);
    expect(storage.promote).toHaveBeenCalledTimes(2);
  });

  it("validates final metadata after confirmed promotion and cleans invalid owned finals", async () => {
    const options = createOptions(supportModels());
    const key = await upload();
    options.input.attachments = [key];
    storage.promote.mockImplementationOnce(
      async (source: string, store: string) => {
        const result = promote(source, store);
        storage.files.get(address(result.resourceKey, store))!.size =
          SUPPORT_ATTACHMENT_MAX_SIZE + 1;
        return result;
      },
    );
    await expect(createSupportTicket(options)).rejects.toMatchObject({
      status: 400,
    });
    expect(storage.metadata).toHaveBeenCalledWith(
      stripStagingPrefix(key),
      STORE,
    );
    expect(storage.metadata).not.toHaveBeenCalledWith(key, expect.anything());
    expect(storage.remove).toHaveBeenCalledWith(stripStagingPrefix(key), STORE);
    expect(await options.models.tickets.getAll()).toHaveLength(0);
  });

  it("preserves a foreign occupied final even when it owns the staged source", async () => {
    const options = createOptions(supportModels());
    const key = await upload();
    options.input.attachments = [key];
    const finalKey = stripStagingPrefix(key);
    storage.files.set(address(finalKey), {
      ...storage.files.get(address(key))!,
      resourceKey: finalKey,
      filename: "foreign.txt",
    });
    await expect(createSupportTicket(options)).rejects.toMatchObject({
      status: 409,
    });
    expect(storage.files.get(address(finalKey))?.filename).toBe("foreign.txt");
    expect(storage.remove).not.toHaveBeenCalledWith(finalKey, STORE);
    await recoverSupportOperations("tenant-a", options.models);
    expect(storage.remove).not.toHaveBeenCalledWith(finalKey, STORE);
    expect(storage.promote).toHaveBeenCalledTimes(1);
  });

  it("retains an unconfirmed final after uncertainty rather than promoting rejected work for cleanup", async () => {
    const options = createOptions(supportModels());
    const key = await upload();
    options.input.attachments = [key];
    storage.promote.mockImplementationOnce(
      async (source: string, store: string) => {
        promote(source, store);
        throw new Error("unknown");
      },
    );
    await expect(createSupportTicket(options)).rejects.toThrow("unknown");
    storage.promote.mockRejectedValueOnce(
      new FileConflictError(stripStagingPrefix(key)),
    );
    await expect(createSupportTicket(options)).rejects.toMatchObject({
      status: 409,
    });
    await recoverSupportOperations("tenant-a", options.models);
    expect(storage.files.has(address(stripStagingPrefix(key)))).toBe(true);
    expect(storage.promote).toHaveBeenCalledTimes(2);
  });

  it("repeats confirmed cleanup for a late orphan without resurrecting the rejected ticket", async () => {
    const options = createOptions(supportModels());
    const key = await upload();
    const missing = await upload();
    const original = storage.files.get(address(key))!;
    storage.files.delete(address(missing));
    options.input.attachments = [key, missing];
    await expect(createSupportTicket(options)).rejects.toMatchObject({
      status: 409,
    });
    const finalKey = stripStagingPrefix(key);
    storage.files.set(address(finalKey), {
      ...original,
      resourceKey: finalKey,
    });
    await recoverSupportOperations("tenant-a", options.models);
    expect(storage.files.has(address(finalKey))).toBe(false);
    expect(storage.promote).toHaveBeenCalledTimes(2);
    expect(await options.models.messages.getAll()).toHaveLength(0);
  });

  it("does not publish when a delayed promotion completes after prepared cancellation", async () => {
    const options = createOptions(supportModels());
    const key = await upload();
    options.input.attachments = [key];
    const source = storage.files.get(address(key))!;
    const entered = Promise.withResolvers<void>();
    const resume = Promise.withResolvers<void>();
    storage.promote
      .mockImplementationOnce(async () => {
        entered.resolve();
        await resume.promise;
        const resourceKey = stripStagingPrefix(key);
        storage.files.set(address(resourceKey), { ...source, resourceKey });
        return { resourceKey };
      })
      .mockRejectedValueOnce(new FileNotFoundError(key));
    const delayed = createSupportTicket(options);
    const rejected = expect(delayed).rejects.toMatchObject({ status: 409 });
    await entered.promise;
    await expect(createSupportTicket(options)).rejects.toMatchObject({
      status: 409,
    });
    resume.resolve();
    await rejected;
    expect(await options.models.tickets.getAll()).toHaveLength(0);
    expect(await options.models.messages.getAll()).toHaveLength(0);
    expect(storage.files.has(address(stripStagingPrefix(key)))).toBe(false);
  });

  it("retains a successful final when the promotion-confirmation acknowledgement is lost", async () => {
    const options = createOptions(supportModels());
    const key = await upload();
    options.input.attachments = [key];
    const admissions = GetModel(SupportAttachmentAdmissionModel);
    const confirm = admissions.confirmPromotion.bind(admissions);
    vi.spyOn(admissions, "confirmPromotion").mockImplementationOnce(
      async (admission) => {
        await confirm(admission);
        throw new Error("confirmation acknowledgement lost");
      },
    );
    await expect(createSupportTicket(options)).rejects.toThrow(
      "confirmation acknowledgement lost",
    );
    expect(storage.remove).not.toHaveBeenCalled();
    await createSupportTicket(options);
    await recoverSupportOperations("tenant-a", options.models);
    expect(storage.files.has(address(stripStagingPrefix(key)))).toBe(true);
    expect(storage.remove).not.toHaveBeenCalled();
    expect(await options.models.messages.getAll()).toHaveLength(1);
  });

  it("keeps issuance routing when configuration chooses another named store", async () => {
    const options = createOptions(supportModels());
    const key = await upload();
    options.input.attachments = [key];
    selectSupportStorage("support-secondary");
    await createSupportTicket(options);
    expect(storage.promote).toHaveBeenCalledWith(key, STORE);
    expect(storage.metadata).toHaveBeenCalledWith(
      stripStagingPrefix(key),
      STORE,
    );
    expect(
      await GetModel(SupportAttachmentAdmissionModel).getBy("stagedKey", key),
    ).toMatchObject([{ storage: STORE }]);
  });

  it.each([
    "__staging__/support-attachments/tenant-a/unissued",
    "__staging__/support-attachments/tenant-b/private",
    "__staging__/support-attachments/tenant-a/../private",
    "support-attachments/tenant-a/final",
  ])("rejects unissued/unsafe key %s before promotion", async (key) => {
    const options = createOptions(supportModels());
    options.input.attachments = [key];
    await expect(createSupportTicket(options)).rejects.toMatchObject({
      status: 400,
    });
    expect(storage.promote).not.toHaveBeenCalled();
    expect(storage.remove).not.toHaveBeenCalled();
  });

  it("rejects another tenant's issued upload without granting cleanup rights", async () => {
    const options = createOptions(supportModels());
    options.input.attachments = [await upload("tenant-b")];
    await expect(createSupportTicket(options)).rejects.toMatchObject({
      status: 400,
    });
    expect(storage.promote).not.toHaveBeenCalled();
    expect(storage.remove).not.toHaveBeenCalled();
  });
});
