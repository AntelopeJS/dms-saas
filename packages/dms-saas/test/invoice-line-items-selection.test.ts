import type { InvoiceLineItem } from "@antelopejs/interface-dms-saas/invoice-line-items";
import {
  buildInvoiceLineKey,
  selectInvoiceLineItemsToCreate,
} from "@antelopejs/interface-dms-saas/invoice-line-items";
import { describe, expect, it } from "vitest";

const PROVIDER_ID = "cloud";

function usageLine(overrides: Partial<InvoiceLineItem> = {}): InvoiceLineItem {
  return {
    key: "vcpu-minutes",
    description: "vCPU minutes",
    amountCents: 1250,
    ...overrides,
  };
}

describe("selectInvoiceLineItemsToCreate", () => {
  it("namespaces line keys with the provider id", () => {
    const selection = selectInvoiceLineItemsToCreate(
      PROVIDER_ID,
      [usageLine()],
      new Set(),
    );

    expect(selection.accepted).toHaveLength(1);
    expect(selection.accepted[0]?.lineKey).toBe("cloud:vcpu-minutes");
    expect(selection.skipped).toEqual([]);
  });

  it("lets two providers bill the same metric name", () => {
    const injectedKeys = new Set([buildInvoiceLineKey("cloud", "egress")]);

    const selection = selectInvoiceLineItemsToCreate(
      "analytics",
      [usageLine({ key: "egress" })],
      injectedKeys,
    );

    expect(selection.accepted[0]?.lineKey).toBe("analytics:egress");
  });

  it("skips a line already injected by a previous webhook delivery", () => {
    const injectedKeys = new Set([
      buildInvoiceLineKey(PROVIDER_ID, "vcpu-minutes"),
    ]);

    const selection = selectInvoiceLineItemsToCreate(
      PROVIDER_ID,
      [usageLine()],
      injectedKeys,
    );

    expect(selection.accepted).toEqual([]);
    expect(selection.skipped).toEqual([
      { lineKey: "cloud:vcpu-minutes", reason: "already_invoiced" },
    ]);
  });

  it("keeps a single line when the provider returns the same key twice", () => {
    const selection = selectInvoiceLineItemsToCreate(
      PROVIDER_ID,
      [usageLine({ amountCents: 1250 }), usageLine({ amountCents: 4200 })],
      new Set(),
    );

    expect(selection.accepted).toHaveLength(1);
    expect(selection.accepted[0]?.item.amountCents).toBe(1250);
    expect(selection.skipped).toEqual([
      { lineKey: "cloud:vcpu-minutes", reason: "duplicate_key" },
    ]);
  });

  it("treats a surrounding-whitespace variant as the same key", () => {
    const injectedKeys = new Set([
      buildInvoiceLineKey(PROVIDER_ID, "vcpu-minutes"),
    ]);

    const selection = selectInvoiceLineItemsToCreate(
      PROVIDER_ID,
      [usageLine({ key: "  vcpu-minutes  " })],
      injectedKeys,
    );

    expect(selection.accepted).toEqual([]);
    expect(selection.skipped[0]?.reason).toBe("already_invoiced");
  });

  it("accepts a negative amount so an included credit can be deducted", () => {
    const selection = selectInvoiceLineItemsToCreate(
      PROVIDER_ID,
      [usageLine({ key: "included-credit", amountCents: -1000 })],
      new Set(),
    );

    expect(selection.accepted).toHaveLength(1);
    expect(selection.accepted[0]?.item.amountCents).toBe(-1000);
  });

  it("drops zero amounts and structurally unusable lines", () => {
    const selection = selectInvoiceLineItemsToCreate(
      PROVIDER_ID,
      [
        usageLine({ key: "unused-metric", amountCents: 0 }),
        usageLine({ key: "  ", description: "Blank key" }),
        usageLine({ key: "no-label", description: "" }),
        usageLine({ key: "fractional", amountCents: 12.5 }),
        usageLine({ key: "over-cap", amountCents: Number.MAX_VALUE }),
      ],
      new Set(),
    );

    expect(selection.accepted).toEqual([]);
    expect(selection.skipped.map((line) => line.reason)).toEqual([
      "zero_amount",
      "invalid",
      "invalid",
      "invalid",
      "invalid",
    ]);
  });

  it("rejects a key too long for Stripe's idempotency key", () => {
    const selection = selectInvoiceLineItemsToCreate(
      PROVIDER_ID,
      [usageLine({ key: "x".repeat(200) })],
      new Set(),
    );

    expect(selection.accepted).toEqual([]);
    expect(selection.skipped[0]?.reason).toBe("invalid");
  });

  it("rejects a key holding the namespace separator", () => {
    const selection = selectInvoiceLineItemsToCreate(
      "cloud",
      [usageLine({ key: "b:c" })],
      new Set([buildInvoiceLineKey("cloud:b", "c")]),
    );

    expect(selection.accepted).toEqual([]);
    expect(selection.skipped[0]?.reason).toBe("invalid");
  });

  it("leaves the already-injected key set untouched", () => {
    const injectedKeys = new Set<string>();

    selectInvoiceLineItemsToCreate(PROVIDER_ID, [usageLine()], injectedKeys);

    expect(injectedKeys.size).toBe(0);
  });
});
