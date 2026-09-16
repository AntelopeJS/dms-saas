import type Stripe from "stripe";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CreditNote, Invoice } from "../src/db";

interface NamedModel {
  name: string;
}

const harness = vi.hoisted(() => ({
  models: new Map<string, unknown>(),
  notify: vi.fn<() => Promise<void>>(),
  retrieveInvoice: vi.fn<() => Promise<unknown>>(),
  retrieveCreditNote: vi.fn<() => Promise<unknown>>(),
  listCreditNoteLines: vi.fn<() => unknown>(),
  issuedUpdateReached: vi.fn(),
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

vi.mock("../src/notifications", () => ({
  creditNoteIssuedSubject: "credit-note-issued",
  notifyTenantMembers: vi.fn(async () => undefined),
  notifyTenantOwners: (...args: unknown[]) => harness.notify(...args),
}));

vi.mock("../src/stripe/client", () => ({
  getStripeClient: () => ({
    invoices: {
      retrieve: (...args: unknown[]) => harness.retrieveInvoice(...args),
    },
    creditNotes: {
      retrieve: (...args: unknown[]) => harness.retrieveCreditNote(...args),
      listLineItems: (...args: unknown[]) =>
        harness.listCreditNoteLines(...args),
    },
  }),
}));

import {
  handleCreditNoteCreated,
  handleCreditNoteVoided,
} from "../src/stripe/webhook-credit-notes";

const TENANT_ID = "tenant_123";
const CREATED_SECONDS = 1_788_264_000;
const VOIDED_SECONDS = CREATED_SECONDS + 3_600;

let invoices: Invoice[];
let creditNotes: CreditNote[];
let currentCreditNote: Stripe.CreditNote;
let issuedUpdateBarrier: Promise<void> | null;

function invoiceFixture(): Invoice {
  return {
    _id: "invoice-row",
    documentType: "invoice",
    stripeInvoiceId: "in_123",
    stripeCreditNoteId: null,
    number: "INV-0042",
    periodStart: new Date("2026-08-01T00:00:00.000Z"),
    periodEnd: new Date("2026-09-01T00:00:00.000Z"),
  } as Invoice;
}

function stripeInvoiceFixture(): Stripe.Invoice {
  return {
    id: "in_123",
    object: "invoice",
    customer: "cus_123",
    number: "INV-0042",
    amount_due: 12_000,
    subtotal: 10_000,
    tax: 2_000,
    total: 12_000,
    currency: "eur",
    status: "paid",
    hosted_invoice_url: "https://invoice.stripe.test/in_123",
    invoice_pdf: "https://invoice.stripe.test/in_123.pdf",
    metadata: {},
    period_start: CREATED_SECONDS - 2_592_000,
    period_end: CREATED_SECONDS,
    created: CREATED_SECONDS,
    status_transitions: { paid_at: CREATED_SECONDS },
    lines: { data: [], has_more: false },
  } as unknown as Stripe.Invoice;
}

function creditNoteFixture(
  status: Stripe.CreditNote.Status = "issued",
): Stripe.CreditNote {
  return {
    id: "cn_123",
    object: "credit_note",
    amount: 3_600,
    created: CREATED_SECONDS,
    effective_at: CREATED_SECONDS + 60,
    currency: "eur",
    customer: "cus_123",
    invoice: "in_123",
    lines: {
      data: [
        {
          id: "cnli_123",
          description: "Unused subscription period",
          quantity: 1,
          amount: 3_000,
        },
      ],
      has_more: false,
    },
    memo: "Prorated cancellation",
    metadata: { source: "admin" },
    number: "CN-0042-1",
    pdf: "https://invoice.stripe.test/cn_123.pdf",
    reason: "order_change",
    refund: "re_123",
    customer_balance_transaction: null,
    out_of_band_amount: null,
    status,
    subtotal: 3_000,
    tax_amounts: [{ amount: 600 }],
    total: 3_600,
    type: "post_payment",
    voided_at: status === "void" ? VOIDED_SECONDS : null,
  } as unknown as Stripe.CreditNote;
}

function event(type: string, creditNote: Stripe.CreditNote): Stripe.Event {
  return {
    id: `evt_${type}`,
    type,
    data: { object: creditNote },
  } as Stripe.Event;
}

function invoiceModel() {
  return {
    findOneByStripeInvoice: async (id: string) =>
      invoices.find(
        (row) => row.stripeInvoiceId === id && !row.stripeCreditNoteId,
      ),
    findOneByStripeCreditNote: async (id: string) =>
      invoices.find((row) => row.stripeCreditNoteId === id),
    insert: async (row: Invoice) => {
      invoices.push({
        ...row,
        _id: row._id ?? `invoice-row-${invoices.length + 1}`,
      });
    },
    update: async (id: string, patch: Partial<Invoice>) => {
      Object.assign(
        invoices.find((row) => row._id === id),
        patch,
      );
    },
    updateUnlessVoided: async (id: string, patch: Partial<Invoice>) => {
      harness.issuedUpdateReached();
      await issuedUpdateBarrier;
      const invoice = invoices.find((row) => row._id === id);
      if (invoice?.status === "void") return false;
      Object.assign(invoice, patch);
      return true;
    },
  };
}

function creditNoteModel() {
  return {
    findOneByStripeCreditNote: async (id: string) =>
      creditNotes.find((row) => row.stripeCreditNoteId === id),
    insert: async (row: CreditNote) => {
      creditNotes.push({
        ...row,
        _id: row._id ?? `credit-note-row-${creditNotes.length + 1}`,
      });
    },
    update: async (id: string, patch: Partial<CreditNote>) => {
      Object.assign(
        creditNotes.find((row) => row._id === id),
        patch,
      );
    },
    updateUnlessVoided: async (id: string, patch: Partial<CreditNote>) => {
      harness.issuedUpdateReached();
      await issuedUpdateBarrier;
      const creditNote = creditNotes.find((row) => row._id === id);
      if (creditNote?.status === "void") return false;
      Object.assign(creditNote, patch);
      return true;
    },
  };
}

beforeEach(() => {
  invoices = [invoiceFixture()];
  creditNotes = [];
  issuedUpdateBarrier = null;
  harness.models.clear();
  harness.models.set("TenantSubscriptionModel", {
    findOneByStripeCustomer: async () => ({ _instance: TENANT_ID }),
  });
  harness.models.set("InvoiceModel", invoiceModel());
  harness.models.set("CreditNoteModel", creditNoteModel());
  harness.notify.mockReset();
  currentCreditNote = creditNoteFixture();
  harness.retrieveCreditNote
    .mockReset()
    .mockImplementation(async () => currentCreditNote);
  harness.retrieveInvoice.mockReset().mockResolvedValue(stripeInvoiceFixture());
  harness.listCreditNoteLines.mockReset();
  harness.issuedUpdateReached.mockReset();
});

describe("Stripe credit note mirror", () => {
  it("adds a linked negative billing row with Stripe PDF and details", async () => {
    await handleCreditNoteCreated(
      event("credit_note.created", creditNoteFixture()),
    );

    expect(creditNotes).toHaveLength(1);
    expect(creditNotes[0]).toMatchObject({
      invoiceId: "invoice-row",
      stripeCreditNoteId: "cn_123",
      pdfUrl: "https://invoice.stripe.test/cn_123.pdf",
      refundId: "re_123",
      status: "issued",
    });
    expect(invoices[1]).toMatchObject({
      documentType: "credit_note",
      stripeInvoiceId: "in_123",
      stripeCreditNoteId: "cn_123",
      parentInvoiceNumber: "INV-0042",
      number: "CN-0042-1",
      amount: -3_600,
      subtotal: -3_000,
      tax: -600,
      total: -3_600,
      status: "issued",
      creditNoteReason: "order_change",
      creditNoteType: "post_payment",
      memo: "Prorated cancellation",
      invoicePdfUrl: "https://invoice.stripe.test/cn_123.pdf",
    });
    expect(invoices[1]?.lines[0]?.amount).toBe(-3_000);
    expect(harness.notify).toHaveBeenCalledOnce();
  });

  it("upserts rather than duplicating a replayed credit note", async () => {
    const replay = event("credit_note.created", creditNoteFixture());
    await handleCreditNoteCreated(replay);
    await handleCreditNoteCreated(replay);

    expect(creditNotes).toHaveLength(1);
    expect(
      invoices.filter((row) => row.documentType === "credit_note"),
    ).toHaveLength(1);
  });

  it("updates both mirrors when Stripe voids the credit note", async () => {
    await handleCreditNoteCreated(
      event("credit_note.created", creditNoteFixture()),
    );
    currentCreditNote = creditNoteFixture("void");
    await handleCreditNoteVoided(
      event("credit_note.voided", currentCreditNote),
    );

    expect(creditNotes[0]?.status).toBe("void");
    expect(creditNotes[0]?.voidedAt).toEqual(new Date(VOIDED_SECONDS * 1_000));
    expect(invoices[1]?.status).toBe("void");
    expect(invoices[1]?.voidedAt).toEqual(new Date(VOIDED_SECONDS * 1_000));
    expect(invoices[1]?.amount).toBe(-3_600);
    expect(harness.notify).toHaveBeenCalledOnce();
  });

  it("recovers and links a missing invoice mirror before inserting", async () => {
    invoices = [];

    await handleCreditNoteCreated(
      event("credit_note.created", creditNoteFixture()),
    );

    expect(harness.retrieveInvoice).toHaveBeenCalledWith("in_123");
    expect(invoices.map((row) => row.documentType)).toEqual([
      "invoice",
      "credit_note",
    ]);
    expect(creditNotes[0]?.invoiceId).toBe(invoices[0]?._id);
  });

  it("refreshes an incomplete invoice mirror before linking the credit note", async () => {
    invoices[0] = { ...invoiceFixture(), number: null };

    await handleCreditNoteCreated(
      event("credit_note.created", creditNoteFixture()),
    );

    expect(harness.retrieveInvoice).toHaveBeenCalledWith("in_123");
    expect(creditNotes[0]?.invoiceId).toBe("invoice-row");
    expect(invoices[1]?.parentInvoiceNumber).toBe("INV-0042");
  });

  it("uses Stripe's current state when a created event arrives after voiding", async () => {
    currentCreditNote = creditNoteFixture("void");

    await handleCreditNoteCreated(
      event("credit_note.created", creditNoteFixture("issued")),
    );

    expect(creditNotes[0]?.status).toBe("void");
    expect(invoices[1]?.status).toBe("void");
    expect(harness.notify).not.toHaveBeenCalled();
  });

  it("keeps void terminal when created and voided handlers overlap", async () => {
    await handleCreditNoteCreated(
      event("credit_note.created", creditNoteFixture()),
    );
    harness.notify.mockReset();
    let releaseIssuedUpdate = () => undefined;
    issuedUpdateBarrier = new Promise<void>((resolve) => {
      releaseIssuedUpdate = resolve;
    });
    harness.retrieveCreditNote
      .mockResolvedValueOnce(creditNoteFixture())
      .mockResolvedValueOnce(creditNoteFixture("void"));

    const created = handleCreditNoteCreated(
      event("credit_note.created-late", creditNoteFixture()),
    );
    await vi.waitFor(() =>
      expect(harness.issuedUpdateReached).toHaveBeenCalled(),
    );
    await handleCreditNoteVoided(
      event("credit_note.voided", creditNoteFixture("void")),
    );
    releaseIssuedUpdate();
    await created;

    expect(creditNotes[0]?.status).toBe("void");
    expect(invoices[1]?.status).toBe("void");
    expect(harness.notify).not.toHaveBeenCalled();
  });

  it("links an expanded Stripe invoice reference", async () => {
    currentCreditNote = creditNoteFixture();
    currentCreditNote.invoice = stripeInvoiceFixture();

    await handleCreditNoteCreated(
      event("credit_note.created", currentCreditNote),
    );

    expect(creditNotes[0]?.invoiceId).toBe("invoice-row");
    expect(invoices[1]?.stripeInvoiceId).toBe("in_123");
  });

  it("uses Stripe effective date, tax amounts, and credit-note type", async () => {
    currentCreditNote = creditNoteFixture();
    currentCreditNote.subtotal = 3_400;

    await handleCreditNoteCreated(
      event("credit_note.created", currentCreditNote),
    );

    expect(invoices[1]).toMatchObject({
      subtotal: -3_400,
      tax: -600,
      creditNoteType: "post_payment",
      issuedAt: new Date((CREATED_SECONDS + 60) * 1_000),
    });
  });

  it("mirrors every credit note line when Stripe paginates the event", async () => {
    const creditNote = creditNoteFixture();
    creditNote.lines.has_more = true;
    currentCreditNote = creditNote;
    harness.listCreditNoteLines.mockReturnValue({
      autoPagingEach: async (
        callback: (line: Stripe.CreditNoteLineItem) => void,
      ) => {
        for (const line of [
          ...creditNote.lines.data,
          { description: "Tax adjustment", quantity: 1, amount: 600 },
        ]) {
          callback(line as Stripe.CreditNoteLineItem);
        }
      },
    });

    await handleCreditNoteCreated(event("credit_note.created", creditNote));

    expect(harness.listCreditNoteLines).toHaveBeenCalledWith("cn_123", {
      limit: 100,
    });
    expect(invoices[1]?.lines.map((line) => line.amount)).toEqual([
      -3_000, -600,
    ]);
  });
});
