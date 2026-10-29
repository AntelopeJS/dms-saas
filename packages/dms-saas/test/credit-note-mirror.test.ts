import { randomUUID } from "node:crypto";
import { ImplementInterface } from "@antelopejs/interface-core";
import { GetModel } from "@antelopejs/interface-database-decorators";
import * as notifications from "@antelopejs/interface-dms/notifications";
import { fromPartial } from "@total-typescript/shoehorn";
import type Stripe from "stripe";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  CreditNoteModel,
  InvoiceModel,
  TenantSubscriptionModel,
} from "../src/db";
import {
  handleCreditNoteCreated,
  handleCreditNoteVoided,
} from "../src/stripe/webhook-credit-notes";
import { addTenantMember, createUser } from "./helpers/dms";
import { useMongoDatabase } from "./helpers/mongo";
import { useSuiteStripe } from "./helpers/stripe";

useMongoDatabase("credit-note-mirror");
const stripe = useSuiteStripe();

const CREATED_SECONDS = 1_788_264_000;
const VOIDED_SECONDS = CREATED_SECONDS + 3_600;

const sendToUser = vi.fn<typeof notifications.internal.SendToUser>();

ImplementInterface(notifications, {
  internal: {
    SupportsIdempotency: async () => false,
    RegisterNotificationCategory: {
      register: () => undefined,
      unregister: () => undefined,
    },
    RegisterNotificationSubject: {
      register: () => undefined,
      unregister: () => undefined,
    },
    SendToUser: sendToUser,
    SendToUsers: vi.fn(),
    SendToRoles: vi.fn(),
    SendToAll: vi.fn(),
  },
});

interface Workspace {
  tenantId: string;
  customerId: string;
  invoiceRowId: string;
  stripeInvoiceId: string;
  creditNoteId: string;
  ownerId: string;
}

let workspace: Workspace;
let currentCreditNote: Stripe.CreditNote;
let retrieveInvoice: ReturnType<typeof stubInvoiceRead>;

function stripeInvoiceFixture(): Stripe.Invoice {
  return fromPartial<Stripe.Invoice>({
    id: workspace.stripeInvoiceId,
    object: "invoice",
    customer: workspace.customerId,
    number: "INV-0042",
    amount_due: 12_000,
    subtotal: 10_000,
    total_taxes: [{ amount: 2_000 }],
    total: 12_000,
    currency: "eur",
    status: "paid",
    hosted_invoice_url: `https://invoice.stripe.test/${workspace.stripeInvoiceId}`,
    invoice_pdf: `https://invoice.stripe.test/${workspace.stripeInvoiceId}.pdf`,
    metadata: {},
    period_start: CREATED_SECONDS - 2_592_000,
    period_end: CREATED_SECONDS,
    created: CREATED_SECONDS,
    status_transitions: { paid_at: CREATED_SECONDS },
    lines: { data: [], has_more: false },
  });
}

function creditNoteFixture(
  overrides: Partial<Stripe.CreditNote> = {},
): Stripe.CreditNote {
  return fromPartial<Stripe.CreditNote>({
    id: workspace.creditNoteId,
    object: "credit_note",
    amount: 3_600,
    created: CREATED_SECONDS,
    effective_at: CREATED_SECONDS + 60,
    currency: "eur",
    customer: workspace.customerId,
    invoice: workspace.stripeInvoiceId,
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
    pdf: `https://invoice.stripe.test/${workspace.creditNoteId}.pdf`,
    reason: "order_change",
    refunds: [{ amount_refunded: 3_600, refund: "re_123" }],
    customer_balance_transaction: null,
    out_of_band_amount: null,
    status: "issued",
    subtotal: 3_000,
    total_taxes: [{ amount: 600 }],
    total: 3_600,
    type: "post_payment",
    voided_at: null,
    ...overrides,
  });
}

function voidedCreditNote(): Stripe.CreditNote {
  return creditNoteFixture({ status: "void", voided_at: VOIDED_SECONDS });
}

type CreditNoteEvent =
  | Stripe.CreditNoteCreatedEvent
  | Stripe.CreditNoteVoidedEvent;

function event(
  type: CreditNoteEvent["type"],
  creditNote: Stripe.CreditNote,
): CreditNoteEvent {
  return fromPartial<CreditNoteEvent>({
    id: `evt_${type}`,
    type,
    data: { object: creditNote },
  });
}

function stubInvoiceRead() {
  return vi
    .spyOn(stripe.write.invoices, "retrieve")
    .mockImplementation(async () => fromPartial(stripeInvoiceFixture()));
}

function stubCreditNoteRead() {
  return vi
    .spyOn(stripe.write.creditNotes, "retrieve")
    .mockImplementation(async () => fromPartial(currentCreditNote));
}

function mirroredCreditNote() {
  return GetModel(
    CreditNoteModel,
    workspace.tenantId,
  ).findOneByStripeCreditNote(workspace.creditNoteId);
}

function mirroredCreditNoteInvoice() {
  return GetModel(InvoiceModel, workspace.tenantId).findOneByStripeCreditNote(
    workspace.creditNoteId,
  );
}

function mirroredInvoice() {
  return GetModel(InvoiceModel, workspace.tenantId).findOneByStripeInvoice(
    workspace.stripeInvoiceId,
  );
}

function notifiedUserIds(): string[] {
  return sendToUser.mock.calls.map(([userId]) => userId);
}

/**
 * A workspace with an owner and a plain member, billed to a Stripe customer,
 * whose invoice is already mirrored with its number and period. Stripe serves
 * the invoice and the issued credit note against it.
 */
beforeEach(async () => {
  sendToUser.mockReset();
  const tenantId = randomUUID();
  const owner = await createUser();
  workspace = {
    tenantId,
    customerId: `cus_${randomUUID()}`,
    invoiceRowId: randomUUID(),
    stripeInvoiceId: `in_${randomUUID()}`,
    creditNoteId: `cn_${randomUUID()}`,
    ownerId: owner._id,
  };
  await addTenantMember(tenantId, owner, true);
  await addTenantMember(tenantId, await createUser());
  await GetModel(TenantSubscriptionModel, tenantId).insert({
    _id: tenantId,
    planId: "paid",
    status: "active",
    stripeCustomerId: workspace.customerId,
  });
  await GetModel(InvoiceModel, tenantId).insert({
    _id: workspace.invoiceRowId,
    documentType: "invoice",
    stripeInvoiceId: workspace.stripeInvoiceId,
    stripeCreditNoteId: null,
    number: "INV-0042",
    periodStart: new Date("2026-08-01T00:00:00.000Z"),
    periodEnd: new Date("2026-09-01T00:00:00.000Z"),
  });
  currentCreditNote = creditNoteFixture();
  stubCreditNoteRead();
  retrieveInvoice = stubInvoiceRead();
});

describe("Stripe credit note mirror", () => {
  it("adds a linked negative billing row with Stripe PDF and details", async () => {
    await handleCreditNoteCreated(
      event("credit_note.created", creditNoteFixture()),
    );

    expect(await mirroredCreditNote()).toMatchObject({
      invoiceId: workspace.invoiceRowId,
      stripeCreditNoteId: workspace.creditNoteId,
      pdfUrl: `https://invoice.stripe.test/${workspace.creditNoteId}.pdf`,
      refundId: "re_123",
      status: "issued",
    });
    const row = await mirroredCreditNoteInvoice();
    expect(row).toMatchObject({
      documentType: "credit_note",
      stripeInvoiceId: workspace.stripeInvoiceId,
      stripeCreditNoteId: workspace.creditNoteId,
      parentInvoiceNumber: "INV-0042",
      number: "CN-0042-1",
      amount: -3_600,
      subtotal: -3_000,
      tax: -600,
      total: -3_600,
      status: "issued",
      creditNoteReason: "order_change",
      creditNoteType: "refund",
      memo: "Prorated cancellation",
      invoicePdfUrl: `https://invoice.stripe.test/${workspace.creditNoteId}.pdf`,
    });
    expect(row?.lines[0]?.amount).toBe(-3_000);
    expect(notifiedUserIds()).toEqual([workspace.ownerId]);
  });

  it("mirrors a credit note type the local schema does not know as mixed", async () => {
    currentCreditNote = creditNoteFixture({
      refunds: [],
      type: "future_settlement",
    });
    await handleCreditNoteCreated(
      event("credit_note.created", currentCreditNote),
    );

    expect((await mirroredCreditNote())?.type).toBe("mixed");
    expect((await mirroredCreditNoteInvoice())?.creditNoteType).toBe("mixed");
  });

  it.each([
    { refunds: [], balance: "cbtxn_1", type: "credit_to_balance" },
    {
      refunds: [{ amount_refunded: 100, refund: "re_1" }],
      balance: "cbtxn_1",
      type: "mixed",
    },
    { refunds: [], balance: null, type: "post_payment" },
  ])(
    "names how the credit reached the customer: $type",
    async ({ refunds, balance, type }) => {
      currentCreditNote = creditNoteFixture({
        refunds: fromPartial(refunds),
        customer_balance_transaction: fromPartial(balance),
      });
      await handleCreditNoteCreated(
        event("credit_note.created", currentCreditNote),
      );

      expect((await mirroredCreditNote())?.type).toBe(type);
    },
  );

  it("upserts rather than duplicating a replayed credit note", async () => {
    const replay = event("credit_note.created", creditNoteFixture());
    await handleCreditNoteCreated(replay);
    await handleCreditNoteCreated(replay);

    const creditNotes = await GetModel(
      CreditNoteModel,
      workspace.tenantId,
    ).getAll();
    expect(creditNotes).toHaveLength(1);
    const invoices = await GetModel(InvoiceModel, workspace.tenantId).getAll();
    expect(
      invoices.filter((row) => row.documentType === "credit_note"),
    ).toHaveLength(1);
  });

  it("updates both mirrors when Stripe voids the credit note", async () => {
    await handleCreditNoteCreated(
      event("credit_note.created", creditNoteFixture()),
    );
    currentCreditNote = voidedCreditNote();
    await handleCreditNoteVoided(
      event("credit_note.voided", currentCreditNote),
    );

    const creditNote = await mirroredCreditNote();
    expect(creditNote?.status).toBe("void");
    expect(creditNote?.voidedAt).toEqual(new Date(VOIDED_SECONDS * 1_000));
    const row = await mirroredCreditNoteInvoice();
    expect(row?.status).toBe("void");
    expect(row?.voidedAt).toEqual(new Date(VOIDED_SECONDS * 1_000));
    expect(row?.amount).toBe(-3_600);
    expect(notifiedUserIds()).toEqual([workspace.ownerId]);
  });

  it("recovers and links a missing invoice mirror before inserting", async () => {
    await GetModel(InvoiceModel, workspace.tenantId).delete(
      workspace.invoiceRowId,
    );

    await handleCreditNoteCreated(
      event("credit_note.created", creditNoteFixture()),
    );

    expect(retrieveInvoice).toHaveBeenCalledWith(workspace.stripeInvoiceId);
    const invoices = await GetModel(InvoiceModel, workspace.tenantId).getAll();
    expect(invoices.map((row) => row.documentType).toSorted()).toEqual([
      "credit_note",
      "invoice",
    ]);
    expect((await mirroredCreditNote())?.invoiceId).toBe(
      (await mirroredInvoice())?._id,
    );
  });

  it("refreshes an incomplete invoice mirror before linking the credit note", async () => {
    await GetModel(InvoiceModel, workspace.tenantId).update(
      workspace.invoiceRowId,
      { number: null },
    );

    await handleCreditNoteCreated(
      event("credit_note.created", creditNoteFixture()),
    );

    expect(retrieveInvoice).toHaveBeenCalledWith(workspace.stripeInvoiceId);
    expect((await mirroredCreditNote())?.invoiceId).toBe(
      workspace.invoiceRowId,
    );
    expect((await mirroredCreditNoteInvoice())?.parentInvoiceNumber).toBe(
      "INV-0042",
    );
  });

  it("uses Stripe's current state when a created event arrives after voiding", async () => {
    currentCreditNote = voidedCreditNote();

    await handleCreditNoteCreated(
      event("credit_note.created", creditNoteFixture()),
    );

    expect((await mirroredCreditNote())?.status).toBe("void");
    expect((await mirroredCreditNoteInvoice())?.status).toBe("void");
    expect(notifiedUserIds()).toEqual([]);
  });

  it("keeps void terminal when created and voided handlers overlap", async () => {
    await handleCreditNoteCreated(
      event("credit_note.created", creditNoteFixture()),
    );
    sendToUser.mockReset();
    let releaseStaleHandler: () => void = () => undefined;
    const staleHandlerHeld = new Promise<void>((resolve) => {
      releaseStaleHandler = resolve;
    });
    const staleHandlerReached = vi.fn();
    vi.spyOn(stripe.write.creditNotes, "listLineItems").mockReturnValue(
      fromPartial({
        autoPagingEach: async () => {
          staleHandlerReached();
          await staleHandlerHeld;
        },
      }),
    );
    vi.spyOn(stripe.write.creditNotes, "retrieve")
      .mockResolvedValueOnce(
        fromPartial(
          creditNoteFixture({
            lines: fromPartial({ data: [], has_more: true }),
          }),
        ),
      )
      .mockResolvedValueOnce(fromPartial(voidedCreditNote()));

    const created = handleCreditNoteCreated(
      event("credit_note.created", creditNoteFixture()),
    );
    await vi.waitFor(() => expect(staleHandlerReached).toHaveBeenCalled());
    await handleCreditNoteVoided(
      event("credit_note.voided", voidedCreditNote()),
    );
    releaseStaleHandler();
    await created;

    expect((await mirroredCreditNote())?.status).toBe("void");
    expect((await mirroredCreditNoteInvoice())?.status).toBe("void");
    expect(notifiedUserIds()).toEqual([]);
  });

  it("links an expanded Stripe invoice reference", async () => {
    currentCreditNote = creditNoteFixture({ invoice: stripeInvoiceFixture() });

    await handleCreditNoteCreated(
      event("credit_note.created", currentCreditNote),
    );

    expect((await mirroredCreditNote())?.invoiceId).toBe(
      workspace.invoiceRowId,
    );
    expect((await mirroredCreditNoteInvoice())?.stripeInvoiceId).toBe(
      workspace.stripeInvoiceId,
    );
  });

  it("uses Stripe effective date, tax amounts, and credit-note type", async () => {
    currentCreditNote = creditNoteFixture({ subtotal: 3_400 });

    await handleCreditNoteCreated(
      event("credit_note.created", currentCreditNote),
    );

    expect(await mirroredCreditNoteInvoice()).toMatchObject({
      subtotal: -3_400,
      tax: -600,
      creditNoteType: "refund",
      issuedAt: new Date((CREATED_SECONDS + 60) * 1_000),
    });
  });

  it("mirrors every credit note line when Stripe paginates the event", async () => {
    currentCreditNote = creditNoteFixture({
      lines: fromPartial({
        data: [
          {
            id: "cnli_123",
            description: "Unused subscription period",
            quantity: 1,
            amount: 3_000,
          },
        ],
        has_more: true,
      }),
    });
    const listLineItems = vi
      .spyOn(stripe.write.creditNotes, "listLineItems")
      .mockReturnValue(
        fromPartial({
          autoPagingEach: async (
            callback: (line: Stripe.CreditNoteLineItem) => void,
          ) => {
            for (const line of [
              {
                description: "Unused subscription period",
                quantity: 1,
                amount: 3_000,
              },
              { description: "Tax adjustment", quantity: 1, amount: 600 },
            ]) {
              callback(fromPartial(line));
            }
          },
        }),
      );

    await handleCreditNoteCreated(
      event("credit_note.created", currentCreditNote),
    );

    expect(listLineItems).toHaveBeenCalledWith(workspace.creditNoteId, {
      limit: 100,
    });
    expect(
      (await mirroredCreditNoteInvoice())?.lines.map((line) => line.amount),
    ).toEqual([-3_000, -600]);
  });
});
