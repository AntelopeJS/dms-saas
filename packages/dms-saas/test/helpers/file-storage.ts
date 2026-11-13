import { createServer } from "node:http";
import { Readable } from "node:stream";
import { buffer } from "node:stream/consumers";
import { ImplementInterface } from "@antelopejs/interface-core";
import * as fileStorage from "@antelopejs/interface-file-storage";
import { afterAll, assert, beforeAll } from "vitest";
import { isString } from "../../src/utils/primitive-guards";

const HTTP_OK = 200;
const HTTP_NOT_FOUND = 404;
const URL_LIFETIME_MS = 3_600_000;

interface StoredFile {
  body: Buffer;
  filename: string;
  mimetype: string;
  lastModified: number;
}

/**
 * Implements `@antelopejs/interface-file-storage` with files kept in memory,
 * behind a local HTTP server that its presigned URLs point at: an upload URL
 * takes a `PUT` of the file, a read URL answers a `GET` with it.
 */
export function useMemoryFileStorage(): void {
  const files = new Map<string, StoredFile>();
  const pendingUploads = new Map<string, fileStorage.UploadRequest>();
  const server = createServer((request, response) => {
    const key = decodeURIComponent(
      new URL(request.url ?? "/", "http://storage").pathname.slice(1),
    );
    const upload = pendingUploads.get(key);
    if (request.method === "PUT" && upload) {
      void buffer(request).then((body) => {
        pendingUploads.delete(key);
        store(key, upload, body);
        response.writeHead(HTTP_OK).end();
      });
      return;
    }
    const file = files.get(key);
    if (file === undefined) response.writeHead(HTTP_NOT_FOUND).end();
    else response.writeHead(HTTP_OK).end(file.body);
  });
  let origin = "";
  const fileUrl = (key: string) => `${origin}/${encodeURIComponent(key)}`;
  const keyOf = ({ filename, path }: fileStorage.UploadRequest) =>
    path ? `${path}/${filename}` : filename;
  const store = (
    key: string,
    { filename, mimetype }: fileStorage.UploadRequest,
    body: Uint8Array,
  ) => {
    files.set(key, {
      body: Buffer.from(body),
      filename,
      mimetype,
      lastModified: Date.now(),
    });
  };
  const stored = (key: string): StoredFile => {
    const file = files.get(key);
    if (file === undefined) throw new fileStorage.FileNotFoundError(key);
    return file;
  };

  beforeAll(async () => {
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    assert(address !== null && !isString(address));
    origin = `http://127.0.0.1:${address.port}`;
  });
  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  ImplementInterface(fileStorage, {
    internal: {
      createUploadUrl: async (request) => {
        const resourceKey = keyOf(request);
        pendingUploads.set(resourceKey, request);
        return {
          uploadUrl: fileUrl(resourceKey),
          resourceKey,
          expiresAt: Date.now() + URL_LIFETIME_MS,
          headers: {},
        };
      },
      writeFile: async (request, body) => {
        const resourceKey = keyOf(request);
        store(resourceKey, request, body);
        return { resourceKey };
      },
      createReadUrl: async (resourceKey) => ({ url: fileUrl(resourceKey) }),
      readFile: async (resourceKey) => {
        const { body, mimetype } = stored(resourceKey);
        return { body: Readable.from([body]), size: body.length, mimetype };
      },
      deleteFile: async (resourceKey) => {
        files.delete(resourceKey);
      },
      fileExists: async (resourceKey) => files.has(resourceKey),
      getFileMetadata: async (resourceKey) => {
        const { body, filename, mimetype, lastModified } = stored(resourceKey);
        return {
          resourceKey,
          filename,
          size: body.length,
          mimetype,
          lastModified,
        };
      },
      moveFile: async (sourceKey, destKey) => {
        files.set(destKey, stored(sourceKey));
        files.delete(sourceKey);
      },
      promoteFile: async (resourceKey) => {
        const promoted = fileStorage.stripStagingPrefix(resourceKey);
        files.set(promoted, stored(resourceKey));
        files.delete(resourceKey);
        return { resourceKey: promoted };
      },
    },
  });
}
