import type { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import { exportSaasTenantData } from "../src/hooks/tenant-export";
import {
  batchIds,
  createDatasetStream,
  type ExportDatasetSource,
  streamDatasetLines,
  writeDatasetsToArchive,
} from "../src/utils/export-dataset-stream";

interface Row {
  _id: string;
  amount?: number;
}

interface RecordedFetch {
  ids: string[];
}

function rowsById(ids: string[]): Row[] {
  return ids.map((id) => ({ _id: id, amount: Number(id) }));
}

function fakeSource(
  ids: string[],
  fetches: RecordedFetch[] = [],
): ExportDatasetSource<Row> {
  return {
    async listIds() {
      return ids;
    },
    async fetchBatch(batch) {
      fetches.push({ ids: batch });
      return rowsById(batch);
    },
  };
}

async function collect(lines: AsyncIterable<string>): Promise<string[]> {
  const collected: string[] = [];
  for await (const line of lines) collected.push(line);
  return collected;
}

async function readStream(stream: Readable): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf-8");
}

describe("batchIds", () => {
  it("splits into batches of the requested size", () => {
    expect(batchIds(["a", "b", "c", "d", "e"], 2)).toEqual([
      ["a", "b"],
      ["c", "d"],
      ["e"],
    ]);
  });

  it("yields nothing for an empty id list", () => {
    expect(batchIds([], 2)).toEqual([]);
  });

  it("keeps a shorter-than-a-batch list in a single batch", () => {
    expect(batchIds(["a"], 200)).toEqual([["a"]]);
  });
});

describe("streamDatasetLines", () => {
  it("emits one NDJSON line per document", async () => {
    const lines = await collect(
      streamDatasetLines(fakeSource(["1", "2"]), { batchSize: 10 }),
    );

    expect(lines).toEqual([
      `${JSON.stringify({ _id: "1", amount: 1 })}\n`,
      `${JSON.stringify({ _id: "2", amount: 2 })}\n`,
    ]);
  });

  it("emits nothing for an empty collection", async () => {
    expect(
      await collect(streamDatasetLines(fakeSource([]), { batchSize: 10 })),
    ).toEqual([]);
  });

  it("never asks the database for more than one batch of ids at a time", async () => {
    const fetches: RecordedFetch[] = [];

    await collect(
      streamDatasetLines(fakeSource(["1", "2", "3", "4", "5"], fetches), {
        batchSize: 2,
      }),
    );

    expect(fetches.map((fetch) => fetch.ids)).toEqual([
      ["1", "2"],
      ["3", "4"],
      ["5"],
    ]);
  });

  it("holds the next batch back until the current one is consumed", async () => {
    const fetches: RecordedFetch[] = [];
    const lines = streamDatasetLines(
      fakeSource(["1", "2", "3", "4"], fetches),
      {
        batchSize: 2,
      },
    );

    await lines.next();

    expect(fetches).toHaveLength(1);
  });

  it("stops querying the collection an abort interrupted mid-way", async () => {
    const fetches: RecordedFetch[] = [];
    const controller = new AbortController();
    const lines = streamDatasetLines(
      fakeSource(["1", "2", "3", "4", "5", "6"], fetches),
      { batchSize: 2, signal: controller.signal },
    );

    await lines.next();
    controller.abort(new Error("Export exceeded its budget"));

    await expect(collect(lines)).rejects.toThrow("Export exceeded its budget");
    expect(fetches).toHaveLength(1);
  });

  it("never queries an already aborted export", async () => {
    const fetches: RecordedFetch[] = [];
    const controller = new AbortController();
    controller.abort(new Error("Export exceeded its budget"));

    await expect(
      collect(
        streamDatasetLines(fakeSource(["1", "2"], fetches), {
          signal: controller.signal,
        }),
      ),
    ).rejects.toThrow("Export exceeded its budget");
    expect(fetches).toEqual([]);
  });
});

describe("createDatasetStream", () => {
  it("reads back as newline-delimited JSON", async () => {
    const content = await readStream(
      createDatasetStream(fakeSource(["1", "2"]), { batchSize: 10 }),
    );

    expect(content.trimEnd().split("\n").map(JSON.parse)).toEqual([
      { _id: "1", amount: 1 },
      { _id: "2", amount: 2 },
    ]);
  });
});

interface WrittenEntry {
  path: string;
  content: string;
}

function fakeArchive(written: WrittenEntry[]) {
  return {
    async addStream(path: string, stream: Readable): Promise<void> {
      written.push({ path, content: await readStream(stream) });
    },
  };
}

describe("writeDatasetsToArchive", () => {
  it("writes one .jsonl entry per dataset, in order", async () => {
    const written: WrittenEntry[] = [];

    await writeDatasetsToArchive(fakeArchive(written), [
      { entry: "invoices", source: fakeSource(["1"]) },
      { entry: "refunds", source: fakeSource(["2"]) },
    ]);

    expect(written.map((entry) => entry.path)).toEqual([
      "invoices.jsonl",
      "refunds.jsonl",
    ]);
    expect(written[0]?.content).toBe(
      `${JSON.stringify({ _id: "1", amount: 1 })}\n`,
    );
  });

  it("writes an empty entry rather than skipping an empty collection", async () => {
    const written: WrittenEntry[] = [];

    await writeDatasetsToArchive(fakeArchive(written), [
      { entry: "invoices", source: fakeSource([]) },
    ]);

    expect(written).toEqual([{ path: "invoices.jsonl", content: "" }]);
  });

  it("stops on an aborted export instead of writing the next dataset", async () => {
    const written: WrittenEntry[] = [];
    const controller = new AbortController();
    controller.abort(new Error("Export exceeded its budget"));

    await expect(
      writeDatasetsToArchive(
        fakeArchive(written),
        [{ entry: "invoices", source: fakeSource(["1"]) }],
        { signal: controller.signal },
      ),
    ).rejects.toThrow("Export exceeded its budget");
    expect(written).toEqual([]);
  });
});

describe("exportSaasTenantData", () => {
  it("names the contract when the archive sink is missing", async () => {
    await expect(
      exportSaasTenantData(
        "tenant-1",
        undefined as never,
        new AbortController().signal,
      ),
    ).rejects.toThrow(/export archive sink/);
  });
});
