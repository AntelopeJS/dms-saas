import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CreateReadUrl,
  DeleteFile,
  GetFileMetadata,
  stripStagingPrefix,
} from "@antelopejs/interface-file-storage";
import {
  construct,
  destroy,
  getTokenManager,
} from "@antelopejs/file-storage-local";
import { FilesController } from "../node_modules/@antelopejs/dms/dist/routes/files";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { getSupportAttachmentMetadata } from "../src/support/attachments";
import { recoverSupportOperations } from "../src/support/recovery";
import { createSupportTicket } from "../src/support/service";
import { createSupportUpload } from "../src/support/uploads";
import {
  createOptions,
  selectSupportStorage,
  supportModels,
} from "./support-fixture";
import { startLocalStorageHttp } from "./support-local-http";

const STORE = "support-primary";
let storagePath: string;
let http: Awaited<ReturnType<typeof startLocalStorageHttp>>;
beforeAll(async () => {
  storagePath = await mkdtemp(join(tmpdir(), "support-promotion-"));
  http = await startLocalStorageHttp();
  const config = {
    baseUrl: http.url,
    defaultVisibility: "public" as const,
    uploadTokenExpiration: 3600,
    readTokenExpiration: 300,
    cleanupInterval: 0,
  };
  await construct({
    ...config,
    storagePath: join(storagePath, "default"),
    storages: {
      [STORE]: { ...config, storagePath: join(storagePath, "named") },
    },
  });
  selectSupportStorage();
});
afterAll(async () => {
  destroy();
  await http?.close();
  await rm(storagePath, { recursive: true, force: true });
});

async function upload(content = "original evidence") {
  const response = await createSupportUpload("tenant-a", {
    filename: "evidence.txt",
    size: Buffer.byteLength(content),
    mimetype: "text/plain",
  });
  expect(
    (
      await fetch(response.uploadUrl, {
        method: "PUT",
        headers: response.headers,
        body: content,
      })
    ).status,
  ).toBe(200);
  return response;
}

async function read(key: string): Promise<string> {
  const response = await CreateReadUrl(key, undefined, STORE);
  const result = await fetch(response.url);
  expect(result.status).toBe(200);
  return result.text();
}

describe("support real Mongo and local provider HTTP handlers (not API authentication middleware)", () => {
  it("keeps uploads private under public defaults and rejects replay, including after cleanup", async () => {
    const issued = await upload();
    const manager = getTokenManager(STORE);
    expect(await manager.getFileMetadata(issued.resourceKey)).toMatchObject({
      visibility: "private",
    });
    const url = new URL(
      (await CreateReadUrl(issued.resourceKey, undefined, STORE)).url,
    );
    url.searchParams.delete("token");
    expect((await fetch(url)).status).toBe(403);
    expect(
      (
        await fetch(issued.uploadUrl, {
          method: "PUT",
          headers: issued.headers,
          body: "replacement bytes",
        })
      ).status,
    ).toBe(409);
    await DeleteFile(issued.resourceKey, STORE);
    expect(
      (
        await fetch(issued.uploadUrl, {
          method: "PUT",
          headers: issued.headers,
          body: "original evidence",
        })
      ).status,
    ).toBe(409);
  });

  it("preserves the winning publication and exact named storage for a reused source", async () => {
    const options = createOptions(supportModels());
    const issued = await upload();
    options.input.attachments = [issued.resourceKey];
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
    const messages = await options.models.messages.getAll();
    expect(messages).toHaveLength(1);
    expect(await read(messages[0].attachments[0])).toBe("original evidence");
    expect(
      await getTokenManager().getFileMetadata(messages[0].attachments[0]),
    ).toBeNull();
    expect(
      await getSupportAttachmentMetadata(messages[0].attachments[0], STORE),
    ).toMatchObject({ filename: "evidence.txt" });
  });

  it("recovers an interrupted projection with the source gone", async () => {
    const options = createOptions(supportModels());
    options.input.attachments = [(await upload()).resourceKey];
    vi.spyOn(options.models.messages, "insert").mockRejectedValueOnce(
      new Error("interrupted"),
    );
    await expect(createSupportTicket(options)).rejects.toMatchObject({
      status: 503,
    });
    expect(
      await getTokenManager(STORE).getFileMetadata(
        options.input.attachments[0],
      ),
    ).toBeNull();
    const ticket = await createSupportTicket(options);
    expect(await createSupportTicket(options)).toEqual(ticket);
    const messages = await options.models.messages.getAll();
    expect(messages).toHaveLength(1);
    expect(await read(messages[0].attachments[0])).toBe("original evidence");
  });

  it("cleans rejected confirmed promotions on a later owner recovery pass", async () => {
    const options = createOptions(supportModels());
    const issued = await upload();
    const missing = await createSupportUpload("tenant-a", {
      filename: "absent.txt",
      size: 4,
      mimetype: "text/plain",
    });
    options.input.attachments = [issued.resourceKey, missing.resourceKey];
    vi.spyOn(getTokenManager(STORE), "deleteFile").mockRejectedValueOnce(
      new Error("cleanup interrupted"),
    );
    await expect(createSupportTicket(options)).rejects.toThrow(
      "cancellation pending",
    );
    await recoverSupportOperations("tenant-a", options.models);
    expect(
      await getTokenManager(STORE).getFileMetadata(
        stripStagingPrefix(issued.resourceKey),
      ),
    ).toBeNull();
    expect(await options.models.messages.getAll()).toHaveLength(0);
  });

  it("preserves an occupied foreign final and rejects generic DMS metadata bypass", async () => {
    const options = createOptions(supportModels());
    const issued = await upload();
    const finalKey = stripStagingPrefix(issued.resourceKey);
    const manager = getTokenManager(STORE);
    const token = await manager.createUploadToken(
      finalKey,
      "text/plain",
      7,
      Date.now() + 60_000,
      undefined,
      undefined,
      "private",
    );
    await manager.saveUpload(token.token, Buffer.from("foreign"));
    options.input.attachments = [issued.resourceKey];
    await expect(createSupportTicket(options)).rejects.toMatchObject({
      status: 409,
    });
    await recoverSupportOperations("tenant-a", options.models);
    expect(await read(finalKey)).toBe("foreign");
    await expect(
      new FilesController().getMetadata({} as never, finalKey, STORE),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("fails unknown named stores rather than reading the default", async () => {
    const issued = await upload();
    await expect(
      GetFileMetadata(issued.resourceKey, "retired-unknown"),
    ).rejects.toThrow();
  });
});
