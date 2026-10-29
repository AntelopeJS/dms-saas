import { fromPartial } from "@total-typescript/shoehorn";
import { describe, expect, it } from "vitest";
import type { Invoice } from "../src/db";
import {
  type ActivitySources,
  buildActivityFeed,
  isFlatFeed,
  parseActivityKind,
} from "../src/metrics/activity";
import type { OperatorAction } from "../src/operator-actions/db/operator-action.table";

const linkOf = (tenantId: string): string => `/workspaces/${tenantId}`;

const SOURCES: ActivitySources = {
  documents: [
    fromPartial<Invoice & { _instance: string }>({
      _id: "in_1",
      _instance: "t1",
      number: "INV-0941",
      status: "paid",
      currency: "eur",
      total: 135_240,
      amount: 112_700,
      issuedAt: new Date("2026-10-01T09:00:00Z"),
      paidAt: new Date("2026-10-02T09:00:00Z"),
    }),
    fromPartial<Invoice & { _instance: string }>({
      _id: "in_2",
      _instance: "t1",
      number: "INV-0942",
      status: "draft",
      currency: "eur",
      total: 100,
      amount: 100,
      issuedAt: new Date("2026-10-03T09:00:00Z"),
    }),
  ],
  actions: [
    fromPartial<OperatorAction>({
      _id: "op_1",
      tenantId: "t1",
      actorEmail: "camille@ops.test",
      action: "customer_balance.credit",
      status: "succeeded",
      details: { amountCents: 4_900, currency: "EUR" },
      createdAt: new Date("2026-10-04T09:00:00Z"),
      effectiveAt: new Date("2026-10-04T09:00:00Z"),
    }),
    fromPartial<OperatorAction>({
      _id: "op_2",
      tenantId: "t1",
      actorEmail: "camille@ops.test",
      action: "workspace.suspend",
      status: "failed",
      details: {},
      createdAt: new Date("2026-10-05T09:00:00Z"),
      effectiveAt: null,
    }),
  ],
  workspaces: [
    {
      _id: "t1",
      name: "Northwind",
      createdAt: new Date("2025-03-12T09:00:00Z"),
    },
  ],
  names: new Map([["t1", "Northwind"]]),
};

describe("activity feed", () => {
  it("lists what happened, newest first, leaving out drafts and failed actions", () => {
    const items = buildActivityFeed(SOURCES, {
      kind: "all",
      limit: 10,
      linkOf,
    });

    expect(items.map((item) => item.id)).toEqual([
      "action-op_1",
      "document-in_1",
      "workspace-t1",
    ]);
  });

  it("names the workspace and links to it on the platform's feed", () => {
    const [credit, paid] = buildActivityFeed(SOURCES, {
      kind: "all",
      limit: 10,
      linkOf,
    });

    expect(paid).toMatchObject({
      title: "$saas.activity.platform.invoice_paid",
      params: { number: "INV-0941", workspace: "Northwind" },
      meta: [
        {
          key: "saas.text.value",
          params: { value: { type: "money", value: 135_240, currency: "EUR" } },
        },
      ],
      to: "/workspaces/t1",
    });
    expect(credit).toMatchObject({
      title: "$saas.activity.platform.balance_credited",
      meta: [
        {
          key: "saas.text.value",
          params: { value: { type: "money", value: 4_900, currency: "EUR" } },
        },
        "$saas.activity.by_operator",
      ],
      params: { operator: "camille@ops.test" },
    });
  });

  it("does not repeat the workspace on its own feed", () => {
    const items = buildActivityFeed(SOURCES, {
      kind: "all",
      limit: 10,
    });

    expect(items[1]).toMatchObject({
      title: "$saas.activity.workspace.invoice_paid",
    });
    expect(items[1]?.to).toBeUndefined();
  });

  it("keeps money movements apart from lifecycle events", () => {
    const billing = buildActivityFeed(SOURCES, {
      kind: "billing",
      limit: 10,
    });
    const lifecycle = buildActivityFeed(SOURCES, {
      kind: "lifecycle",
      limit: 10,
    });

    expect(billing.map((item) => item.id)).toEqual([
      "action-op_1",
      "document-in_1",
    ]);
    expect(lifecycle.map((item) => item.id)).toEqual(["workspace-t1"]);
  });

  it("cuts the feed at its limit", () => {
    expect(buildActivityFeed(SOURCES, { kind: "all", limit: 1 })).toHaveLength(
      1,
    );
  });

  it("trails older entries with their day on a flat feed", () => {
    const items = buildActivityFeed(SOURCES, {
      kind: "all",
      limit: 10,
      now: new Date("2026-10-04T18:00:00Z"),
    });

    expect(items[0]?.time).toBeUndefined();
    expect(items[1]?.time).toEqual({
      key: "saas.text.value",
      params: {
        value: {
          type: "date",
          value: "2026-10-02T09:00:00.000Z",
          format: "day",
        },
      },
    });
    expect(items[2]?.time).toMatchObject({
      params: { value: { format: "medium" } },
    });
  });

  it("leaves the time to the block on a feed grouped by day", () => {
    const items = buildActivityFeed(SOURCES, { kind: "all", limit: 10 });

    expect(items.every((item) => item.time === undefined)).toBe(true);
    expect(isFlatFeed("true")).toBe(true);
    expect(isFlatFeed(undefined)).toBe(false);
  });

  it("reads an unknown kind as everything", () => {
    expect(parseActivityKind("billing")).toBe("billing");
    expect(parseActivityKind("bogus")).toBe("all");
    expect(parseActivityKind(undefined)).toBe("all");
  });
});

describe("the owner invitation e-mail in the activity feed", () => {
  function sendAction(emailDelivery: string): OperatorAction {
    return fromPartial<OperatorAction>({
      _id: `op_send_${emailDelivery}`,
      tenantId: "t1",
      actorEmail: "camille@ops.test",
      action: "invitation.send",
      status: "succeeded",
      details: { email: "owner@northwind.test", emailDelivery },
      createdAt: new Date("2026-10-06T09:00:00Z"),
      effectiveAt: new Date("2026-10-06T09:00:00Z"),
    });
  }

  it.each([
    ["sent", "invitation_sent", "neutral"],
    ["failed", "invitation_email_failed", "warning"],
  ])("reads an e-mail %s as %s", (delivery, title, tone) => {
    const [entry] = buildActivityFeed(
      { ...SOURCES, actions: [sendAction(delivery)] },
      { kind: "lifecycle", limit: 1 },
    );

    expect(entry).toMatchObject({
      title: `$saas.activity.workspace.${title}`,
      tone,
      params: { email: "owner@northwind.test" },
    });
  });
});
