import { describe, expect, it } from "vitest";
import {
  invoiceStatusDetail,
  invoiceWorkspaceDetail,
} from "../src/data-api/platformOwner/invoice-cells";
import {
  type WorkspaceCellRow,
  workspaceMrrAmount,
  workspaceMrrNote,
  workspaceOwnerLabel,
  workspaceOwnerState,
  workspacePlanDetail,
  workspaceRenewalDate,
  workspaceRenewalSummary,
} from "../src/data-api/platformOwner/workspace-cells";
import { LOCALES, missingKeys } from "./helpers/composed-text";

const NOW = new Date("2026-10-09T10:00:00Z");
const IN_THREE_DAYS = new Date("2026-10-12T09:00:00Z");

const SEAT_ROW: WorkspaceCellRow = {
  billingState: "active",
  planName: "Business",
  planUnitAmountMinor: 2900,
  planInterval: "month",
  planBillingMode: "seat",
  currency: "eur",
  seats: 23,
  isComplimentary: false,
  mrrMinor: 66700,
  ownerName: "Ada",
  ownerEmail: "ada@example.com",
  ownerStatus: "joined",
  renewalKind: "suspends",
  renewsAt: IN_THREE_DAYS,
};

describe("workspace directory cells", () => {
  it("writes a seat plan as its price times the seats", () => {
    expect(workspacePlanDetail(SEAT_ROW)).toEqual({
      key: "saas.workspaces.plan_cell.price_times_seats",
      params: {
        price: { type: "money", value: 2900, currency: "EUR" },
        seats: 23,
        interval: { key: "saas.workspaces.interval.month" },
      },
    });
  });

  it("states a complimentary plan instead of its price", () => {
    expect(workspacePlanDetail({ ...SEAT_ROW, isComplimentary: true })).toEqual(
      { key: "saas.workspaces.plan_cell.complimentary" },
    );
  });

  it("shows no MRR before a first payment", () => {
    const row = { ...SEAT_ROW, billingState: "pending_payment" };
    expect(workspaceMrrAmount(row)).toBeNull();
    expect(workspaceMrrNote(row)).toBeNull();
  });

  it("marks a past-due MRR at risk, in red", () => {
    expect(workspaceMrrNote({ ...SEAT_ROW, billingState: "past_due" })).toEqual(
      { text: "$saas.workspaces.mrr_cell.at_risk", tone: "error" },
    );
  });

  it("names what a trial bills once it converts", () => {
    expect(
      workspaceMrrNote({ ...SEAT_ROW, billingState: "trialing" }),
    ).toMatchObject({
      text: {
        key: "saas.workspaces.mrr_cell.trial",
        params: { amount: { type: "money", currency: "EUR" } },
      },
    });
  });

  it("reads an invited owner by address, in the invitation's tone", () => {
    const row = {
      ...SEAT_ROW,
      ownerName: null,
      ownerStatus: "invited" as const,
    };
    expect(workspaceOwnerLabel(row)).toBe("ada@example.com");
    expect(workspaceOwnerState(row)).toEqual({
      text: "$saas.status.owner.invited",
      tone: "warning",
    });
  });

  it("counts the days to a suspension and dates it in red", () => {
    expect(workspaceRenewalSummary(SEAT_ROW, NOW)).toEqual({
      key: "saas.workspaces.renewal.suspends",
      params: { days: { type: "count", value: 3 } },
    });
    expect(workspaceRenewalDate(SEAT_ROW)).toMatchObject({ tone: "error" });
  });

  it.each(LOCALES)("%s has every key the cells name", (code) => {
    const rows: WorkspaceCellRow[] = [
      SEAT_ROW,
      { ...SEAT_ROW, planBillingMode: "flat", planInterval: "year" },
      { ...SEAT_ROW, billingState: "suspended", isComplimentary: true },
      { ...SEAT_ROW, billingState: "trialing", ownerStatus: "expired" },
    ];
    const texts = rows.flatMap((row) => [
      workspacePlanDetail(row),
      workspaceMrrAmount(row),
      workspaceMrrNote(row),
      workspaceOwnerState(row),
      workspaceRenewalSummary(row, NOW),
      workspaceRenewalDate(row),
    ]);
    expect(missingKeys(texts, code)).toEqual([]);
  });
});

describe("invoice cells", () => {
  const OPEN = {
    status: "open" as const,
    attemptCount: 1,
    nextPaymentAttemptAt: IN_THREE_DAYS,
    dueAt: null,
    autoFinalizesAt: null,
  };

  it("reads a failed payment with its retry, in red", () => {
    expect(invoiceStatusDetail(OPEN, null)).toEqual({
      text: {
        key: "saas.operator_billing.invoices.sub_state.retry",
        params: {
          date: {
            type: "date",
            value: IN_THREE_DAYS.toISOString(),
            format: "day",
          },
        },
      },
      tone: "error",
    });
  });

  it("names the invoice that replaced a void one", () => {
    expect(
      invoiceStatusDetail(
        { ...OPEN, status: "void", attemptCount: 0 },
        "INV-9",
      ),
    ).toEqual({
      text: {
        key: "saas.operator_billing.invoices.sub_state.replaced_by",
        params: { number: "INV-9" },
      },
    });
  });

  it("says nothing about a paid invoice", () => {
    expect(invoiceStatusDetail({ ...OPEN, status: "paid" }, null)).toBeNull();
  });

  it("adds the seats to the plan only when several are billed", () => {
    expect(invoiceWorkspaceDetail("Business", 1)).toBe("Business");
    expect(invoiceWorkspaceDetail("Business", 23)).toEqual({
      key: "saas.operator_billing.cells.plan_seats",
      params: { plan: "Business", seats: 23 },
    });
  });

  it.each(LOCALES)("%s has every key the status line names", (code) => {
    const rows = [
      OPEN,
      { ...OPEN, nextPaymentAttemptAt: null },
      { ...OPEN, attemptCount: 0, dueAt: NOW },
      { ...OPEN, status: "draft" as const, autoFinalizesAt: NOW },
      { ...OPEN, status: "uncollectible" as const },
    ];
    const texts = [
      ...rows.map((row) => invoiceStatusDetail(row, null)),
      invoiceStatusDetail({ ...OPEN, status: "void" }, "INV-1"),
      invoiceWorkspaceDetail("Business", 3),
    ];
    expect(missingKeys(texts, code)).toEqual([]);
  });
});
