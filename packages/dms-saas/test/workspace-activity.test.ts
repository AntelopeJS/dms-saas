import { describe, expect, it } from "vitest";
import type { Invoice } from "../src/db";
import {
  type ActivitySources,
  buildActivityFeed,
  parseActivityKind,
} from "../src/metrics/activity";
import type { OperatorAction } from "../src/operator-actions/db/operator-action.table";

const linkOf = (tenantId: string): string => `/workspaces/${tenantId}`;

const SOURCES: ActivitySources = {
  documents: [
    {
      _id: "in_1",
      _instance: "t1",
      number: "INV-0941",
      status: "paid",
      currency: "eur",
      total: 135_240,
      amount: 112_700,
      issuedAt: new Date("2026-10-01T09:00:00Z"),
      paidAt: new Date("2026-10-02T09:00:00Z"),
    } as unknown as Invoice,
    {
      _id: "in_2",
      _instance: "t1",
      number: "INV-0942",
      status: "draft",
      currency: "eur",
      total: 100,
      amount: 100,
      issuedAt: new Date("2026-10-03T09:00:00Z"),
    } as unknown as Invoice,
  ],
  actions: [
    {
      _id: "op_1",
      tenantId: "t1",
      actorEmail: "camille@ops.test",
      action: "customer_balance.credit",
      status: "succeeded",
      details: { amountCents: 4_900, currency: "EUR" },
      createdAt: new Date("2026-10-04T09:00:00Z"),
      effectiveAt: new Date("2026-10-04T09:00:00Z"),
    } as unknown as OperatorAction,
    {
      _id: "op_2",
      tenantId: "t1",
      actorEmail: "camille@ops.test",
      action: "workspace.suspend",
      status: "failed",
      details: {},
      createdAt: new Date("2026-10-05T09:00:00Z"),
      effectiveAt: null,
    } as unknown as OperatorAction,
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

  it("reads an unknown kind as everything", () => {
    expect(parseActivityKind("billing")).toBe("billing");
    expect(parseActivityKind("bogus")).toBe("all");
    expect(parseActivityKind(undefined)).toBe("all");
  });
});
