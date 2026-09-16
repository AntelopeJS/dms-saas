import { Query, Schema } from "@antelopejs/interface-database";
import type { QueryStage } from "@antelopejs/interface-database/common";
import {
  DatumStaticMetadata,
  getMetadata,
} from "@antelopejs/interface-database-decorators/common";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  SUPPORT_EVENT_ORDER_INDEX,
  SUPPORT_MESSAGE_ORDER_INDEX,
  SUPPORT_TICKET_ORDER_INDEX,
  SUPPORT_TICKET_STATUS_ORDER_INDEX,
  SupportMessage,
  SupportMessageModel,
  SupportTicket,
  SupportTicketEvent,
} from "../src/db";

const schema = new Schema("support-model-tests", {});

afterEach(() => vi.restoreAllMocks());

describe("support database models", () => {
  it("checks attachment ownership without loading messages", async () => {
    const queries: QueryStage[][] = [];
    vi.spyOn(Query.prototype, "run").mockImplementation(
      async function (this: Query<unknown>) {
        queries.push(this.build());
        return 1;
      },
    );
    const model = new SupportMessageModel(schema.instance("tenant-a"));
    expect(await model.hasAttachment("ticket-a", "file-key")).toBe(true);
    expect(queries).toHaveLength(1);
    expect(queries[0].at(-1)?.stage).toBe("count");
    expect(JSON.stringify(queries[0])).toContain('"file-key"');
  });

  it("registers support compound indexes", () => {
    const indexes = (datum: typeof SupportTicket) =>
      getMetadata(datum, DatumStaticMetadata).indexes;
    expect(indexes(SupportTicket)[SUPPORT_TICKET_ORDER_INDEX]).toEqual([
      "lastMessageAt",
      "_id",
    ]);
    expect(indexes(SupportTicket)[SUPPORT_TICKET_STATUS_ORDER_INDEX]).toEqual([
      "status",
      "lastMessageAt",
      "_id",
    ]);
    expect(indexes(SupportMessage)[SUPPORT_MESSAGE_ORDER_INDEX]).toEqual([
      "ticketId",
      "createdAt",
      "_id",
    ]);
    expect(indexes(SupportTicketEvent)[SUPPORT_EVENT_ORDER_INDEX]).toEqual([
      "ticketId",
      "createdAt",
      "_id",
    ]);
  });
});
