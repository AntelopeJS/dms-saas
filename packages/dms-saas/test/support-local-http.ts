import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";
import { PassThrough } from "node:stream";
import type { RequestContext } from "@antelopejs/interface-api";
import { FileStorageController } from "@antelopejs/file-storage-local/dist/routes";

function context(
  request: IncomingMessage,
  response: ServerResponse,
): RequestContext {
  return {
    rawRequest: request,
    rawResponse: response,
    response: {
      setStatus: (status: number) => {
        response.statusCode = status;
      },
      addHeader: (name: string, value: string) =>
        response.setHeader(name, value),
    },
  } as RequestContext;
}

async function handle(
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const controller = new FileStorageController();
  const url = new URL(request.url!, "http://127.0.0.1");
  const storage = url.searchParams.get("storage") ?? undefined;
  const ctx = context(request, response);
  if (request.method === "PUT") {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const result = await controller.handleUpload(
      url.pathname.split("/").at(-1)!,
      request.headers["content-type"],
      request.headers["content-length"],
      storage,
      Buffer.concat(chunks),
      ctx,
    );
    response.statusCode = result.getStatus();
    response.end(JSON.stringify(result.getBody()));
    return;
  }
  const stream = new PassThrough();
  stream.pipe(response);
  await controller.handleDownload(
    url.searchParams.get("token") ?? undefined,
    url.pathname.slice("/file-storage/files/".length),
    storage,
    stream,
    ctx,
  );
}

/** Exercises the provider's actual HTTP handlers over loopback, without substituting storage or claiming API middleware coverage. */
export async function startLocalStorageHttp() {
  const server = createServer((request, response) => {
    handle(request, response).catch(() => {
      response.statusCode = 500;
      response.end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  };
}
