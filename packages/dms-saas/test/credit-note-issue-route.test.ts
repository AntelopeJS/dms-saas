import type { User } from "@antelopejs/interface-dms/auth/db";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CreditNote, InvoiceModel } from "../src/db";

interface NamedModel {
  name: string;
}

const harness = vi.hoisted(() => ({
  models: new Map<string, unknown>(),
  retrieveInvoice: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  createCreditNote: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  retrieveCustomer: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  retrievePaymentMethod: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
}));

vi.mock("@antelopejs/interface-database-decorators", async (importOriginal) => {
  const original =
    await importOriginal<
      typeof import("@antelopejs/interface-database-decorators")
    >();
  return {
    ...original,
    GetModel: (model: NamedModel): unknown => harness.models.get(model.name),
  };
});

vi.mock("../src/stripe/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/stripe/client")>()),
  getStripeClient: () => ({
    invoices: { retrieve: harness.retrieveInvoice },
    creditNotes: { create: harness.createCreditNote },
    customers: { retrieve: harness.retrieveCustomer },
    paymentMethods: { retrieve: harness.retrievePaymentMethod },
  }),
}));

import { SaasCreditNotesIssueController } from "../src/routes/platformOwner/credit-notes-issue";

const TENANT_ID = "tenant_nw";
const ADMIN = { _id: "user_1", name: "Camille Laurent" } as User;
const INVOICE_TOTAL = 112_700;

let invoiceRow: Record<string, unknown> | undefined;
let priorNotes: Partial<CreditNote>[];
let stripeInvoice: Record<string, unknown>;

function invoiceModel(): InvoiceModel {
  return { get: async () => invoiceRow } as unknown as InvoiceModel;
}

function issueBody(overrides: Record<string, unknown> = {}) {
  return {
    invoiceId: "in_row",
    amount: 21_240,
    mode: "credit_to_balance",
    reason: "service_issue",
    requestId: "req_1",
    ...overrides,
  };
}

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("expected a rejection");
}

const controller = new SaasCreditNotesIssueController();

beforeEach(() => {
  invoiceRow = {
    _id: "in_row",
    _instance: TENANT_ID,
    documentType: "invoice",
    stripeInvoiceId: "in_stripe",
    number: "INV-2026-0931",
    status: "paid",
    total: INVOICE_TOTAL,
    tax: 0,
    currency: "eur",
    paidAt: new Date("2026-08-29T00:00:00Z"),
    lines: [],
  };
  priorNotes = [{ number: "CN-0112", amount: 4_900, status: "issued" }];
  stripeInvoice = {
    status: "paid",
    total: INVOICE_TOTAL,
    amount_paid: INVOICE_TOTAL,
    customer: "cus_1",
    pre_payment_credit_notes_amount: 0,
    post_payment_credit_notes_amount: 4_900,
    payments: { data: [] },
  };
  harness.models.set("CreditNoteModel", {
    findByInvoice: async () => priorNotes,
  });
  harness.models.set("TenantModel", {
    get: async () => ({ name: "Northwind Traders" }),
  });
  harness.models.set("TenantSubscriptionModel", {
    findOne: async () => ({
      currentPeriodEnd: new Date("2026-10-29T00:00:00Z"),
    }),
  });
  harness.retrieveInvoice.mockReset();
  harness.retrieveInvoice.mockImplementation(async () => stripeInvoice);
  harness.createCreditNote.mockReset();
  harness.createCreditNote.mockResolvedValue({
    id: "cn_new",
    number: "CN-0119",
    amount: 21_240,
    currency: "eur",
  });
  harness.retrieveCustomer.mockReset();
  harness.retrieveCustomer.mockResolvedValue({
    invoice_settings: {
      default_payment_method: {
        card: { brand: "visa", last4: "4242", exp_month: 1, exp_year: 2030 },
      },
    },
  });
});

describe("credit note preview", () => {
  it("shows what was credited, what is left and where it goes", async () => {
    const preview = await controller.preview(ADMIN, "in_row", invoiceModel());

    expect(preview).toMatchObject({
      credited: 4_900,
      creditable: 107_800,
      modes: ["credit_to_balance", "refund"],
      blockReason: null,
      workspaceName: "Northwind Traders",
      card: { brand: "visa", last4: "4242" },
      priorCredits: [{ number: "CN-0112", amount: 4_900 }],
    });
    expect(preview.nextInvoiceAt).toEqual(new Date("2026-10-29T00:00:00Z"));
  });

  it("names the card that paid the invoice, within Stripe's expansion depth", async () => {
    stripeInvoice.payments = {
      data: [{ payment: { payment_intent: { payment_method: "pm_paid" } } }],
    };
    harness.retrievePaymentMethod.mockResolvedValue({
      card: {
        brand: "mastercard",
        last4: "4444",
        exp_month: 2,
        exp_year: 2031,
      },
      billing_details: { name: "Ada Lovelace" },
    });

    const preview = await controller.preview(ADMIN, "in_row", invoiceModel());

    const [, options] = harness.retrieveInvoice.mock.calls[0] as [
      string,
      { expand: string[] },
    ];
    for (const path of options.expand) {
      expect(path.split(".").length).toBeLessThanOrEqual(4);
    }
    expect(harness.retrievePaymentMethod).toHaveBeenCalledWith("pm_paid");
    expect(preview.card).toMatchObject({ brand: "mastercard", last4: "4444" });
  });

  it("explains why a void invoice cannot be credited", async () => {
    stripeInvoice.status = "void";
    const preview = await controller.preview(ADMIN, "in_row", invoiceModel());

    expect(preview).toMatchObject({ blockReason: "void", creditable: 0 });
  });

  it("does not find a credit note's projection row", async () => {
    invoiceRow = { ...invoiceRow, documentType: "credit_note" };

    expect(
      await rejection(controller.preview(ADMIN, "in_row", invoiceModel())),
    ).toMatchObject({ status: 404 });
  });
});

describe("issuing a credit note", () => {
  it("creates it in Stripe with the request's idempotency key", async () => {
    const issued = await controller.issue(ADMIN, issueBody(), invoiceModel());

    expect(issued).toEqual({
      stripeCreditNoteId: "cn_new",
      number: "CN-0119",
      amount: 21_240,
      currency: "eur",
    });
    expect(harness.createCreditNote).toHaveBeenCalledWith(
      expect.objectContaining({
        invoice: "in_stripe",
        amount: 21_240,
        credit_amount: 21_240,
      }),
      { idempotencyKey: "saas-credit-note:req_1" },
    );
  });

  it("refuses more than the total less what was already credited", async () => {
    const error = await rejection(
      controller.issue(ADMIN, issueBody({ amount: 107_801 }), invoiceModel()),
    );

    expect(error).toMatchObject({ status: 400 });
    expect(harness.createCreditNote).not.toHaveBeenCalled();
  });

  it("counts the credits Stripe knows of before the mirror does", async () => {
    priorNotes = [];
    stripeInvoice.post_payment_credit_notes_amount = 100_000;

    const error = await rejection(
      controller.issue(ADMIN, issueBody(), invoiceModel()),
    );

    expect(error).toMatchObject({ status: 400 });
  });

  it("accepts exactly what is left", async () => {
    await controller.issue(
      ADMIN,
      issueBody({ amount: 107_800 }),
      invoiceModel(),
    );

    expect(harness.createCreditNote).toHaveBeenCalledOnce();
  });

  it.each(["draft", "void", "uncollectible"])(
    "refuses a %s invoice",
    async (status) => {
      stripeInvoice.status = status;

      const error = await rejection(
        controller.issue(ADMIN, issueBody(), invoiceModel()),
      );

      expect(error).toMatchObject({ status: 409 });
      expect(harness.createCreditNote).not.toHaveBeenCalled();
    },
  );

  it("refuses to refund an invoice that was not paid", async () => {
    stripeInvoice.status = "open";

    const error = await rejection(
      controller.issue(ADMIN, issueBody({ mode: "refund" }), invoiceModel()),
    );

    expect(error).toMatchObject({ status: 400 });
  });

  it("refuses an amount that is not a positive whole number", async () => {
    const error = await rejection(
      controller.issue(ADMIN, issueBody({ amount: 0 }), invoiceModel()),
    );

    expect(error).toMatchObject({ status: 400 });
    expect(harness.retrieveInvoice).not.toHaveBeenCalled();
  });
});
