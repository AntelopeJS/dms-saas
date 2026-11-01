import { randomUUID } from "node:crypto";
import { CROSS_INSTANCE } from "@antelopejs/interface-database";
import { GetModel } from "@antelopejs/interface-database-decorators";
import type { User } from "@antelopejs/interface-dms/auth/db";
import { TenantModel } from "@antelopejs/interface-dms/db";
import { fromPartial } from "@total-typescript/shoehorn";
import Stripe from "stripe";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  CreditNoteModel,
  InvoiceModel,
  TenantSubscriptionModel,
} from "../src/db";
import type { IssueCreditNoteBody } from "../src/operator-billing";
import { SaasCreditNotesIssueController } from "../src/routes/platformOwner/credit-notes-issue";
import { captureLogs } from "./helpers/logging";
import { useMongoDatabase } from "./helpers/mongo";
import { withUnconfiguredStripe } from "./helpers/unconfigured-stripe";
import { useSuiteStripe } from "./helpers/stripe";

useMongoDatabase("credit-note-issue-route");
const stripe = useSuiteStripe();
const logs = captureLogs();

const ADMIN = fromPartial<User>({ _id: "user_1", name: "Camille Laurent" });
const INVOICE_TOTAL = 112_700;
const PERIOD_END = new Date("2026-10-29T00:00:00Z");

const controller = new SaasCreditNotesIssueController();

let tenantId: string;
let priorNoteId: string;
let invoiceRowId: string;
let stripeInvoiceId: string;
let stripeInvoice: Stripe.Invoice;
let retrieveInvoice: ReturnType<typeof stubInvoiceRead>;
let createCreditNote: ReturnType<typeof stubCreditNoteCreate>;

function invoiceModel(): InvoiceModel {
  return GetModel(InvoiceModel, CROSS_INSTANCE);
}

function issueBody(overrides: Partial<IssueCreditNoteBody> = {}) {
  return {
    invoiceId: invoiceRowId,
    amount: 21_240,
    mode: "credit_to_balance",
    reason: "service_issue",
    requestId: "req_1",
    ...overrides,
  };
}

function invalidKeyError(): Error {
  return new Stripe.errors.StripeAuthenticationError({
    message: "Invalid API Key provided: sk_test_*******lder",
    type: "authentication_error",
  });
}

function stubInvoiceRead() {
  return vi
    .spyOn(stripe.write.invoices, "retrieve")
    .mockImplementation(async () => fromPartial(stripeInvoice));
}

function stubCreditNoteCreate() {
  return vi.spyOn(stripe.write.creditNotes, "create").mockResolvedValue(
    fromPartial({
      id: "cn_new",
      number: "CN-0119",
      amount: 21_240,
      currency: "eur",
    }),
  );
}

/**
 * Seeds a paid invoice of a workspace named Northwind Traders that already got
 * a credit note of 49.00, a subscription renewing on 2026-10-29, and a default
 * Visa on the Stripe customer.
 */
beforeEach(async () => {
  tenantId = randomUUID();
  priorNoteId = randomUUID();
  invoiceRowId = randomUUID();
  stripeInvoiceId = `in_${randomUUID()}`;
  const now = new Date();
  await GetModel(TenantModel).insert({
    _id: tenantId,
    name: "Northwind Traders",
    createdAt: now,
    updatedAt: now,
  });
  await GetModel(TenantSubscriptionModel, tenantId).insert({
    _id: tenantId,
    planId: "paid",
    status: "active",
    currentPeriodEnd: PERIOD_END,
  });
  await GetModel(InvoiceModel, tenantId).insert({
    _id: invoiceRowId,
    documentType: "invoice",
    stripeInvoiceId,
    number: "INV-2026-0931",
    status: "paid",
    total: INVOICE_TOTAL,
    tax: 0,
    currency: "eur",
    paidAt: new Date("2026-08-29T00:00:00Z"),
    lines: [],
  });
  await GetModel(CreditNoteModel, tenantId).insert({
    _id: priorNoteId,
    invoiceId: invoiceRowId,
    number: "CN-0112",
    amount: 4_900,
    currency: "eur",
    status: "issued",
    issuedAt: new Date("2026-09-01T00:00:00Z"),
  });
  stripeInvoice = fromPartial<Stripe.Invoice>({
    status: "paid",
    total: INVOICE_TOTAL,
    amount_paid: INVOICE_TOTAL,
    customer: "cus_1",
    pre_payment_credit_notes_amount: 0,
    post_payment_credit_notes_amount: 4_900,
    payments: { data: [] },
  });
  retrieveInvoice = stubInvoiceRead();
  createCreditNote = stubCreditNoteCreate();
  vi.spyOn(stripe.read.customers, "retrieve").mockResolvedValue(
    fromPartial({
      invoice_settings: {
        default_payment_method: {
          card: { brand: "visa", last4: "4242", exp_month: 1, exp_year: 2030 },
        },
      },
    }),
  );
});

describe("credit note preview", () => {
  it("shows what was credited, what is left and where it goes", async () => {
    const preview = await controller.preview(
      ADMIN,
      invoiceRowId,
      invoiceModel(),
    );

    expect(preview).toMatchObject({
      credited: 4_900,
      creditable: 107_800,
      modes: ["credit_to_balance", "refund"],
      blockReason: null,
      workspaceName: "Northwind Traders",
      card: { brand: "visa", last4: "4242" },
      priorCredits: [{ number: "CN-0112", amount: 4_900 }],
    });
    expect(preview.nextInvoiceAt).toEqual(PERIOD_END);
  });

  it("names the card that paid the invoice, within Stripe's expansion depth", async () => {
    stripeInvoice.payments = fromPartial({
      data: [{ payment: { payment_intent: { payment_method: "pm_paid" } } }],
    });
    const retrievePaymentMethod = vi
      .spyOn(stripe.write.paymentMethods, "retrieve")
      .mockResolvedValue(
        fromPartial({
          card: {
            brand: "mastercard",
            last4: "4444",
            exp_month: 2,
            exp_year: 2031,
          },
          billing_details: { name: "Ada Lovelace" },
        }),
      );

    const preview = await controller.preview(
      ADMIN,
      invoiceRowId,
      invoiceModel(),
    );

    const expansion = retrieveInvoice.mock.calls[0]?.[1]?.expand ?? [];
    expect(expansion).not.toEqual([]);
    for (const path of expansion) {
      expect(path.split(".").length).toBeLessThanOrEqual(4);
    }
    expect(retrievePaymentMethod).toHaveBeenCalledWith("pm_paid");
    expect(preview.card).toMatchObject({ brand: "mastercard", last4: "4444" });
  });

  it("explains why a void invoice cannot be credited", async () => {
    stripeInvoice.status = "void";
    const preview = await controller.preview(
      ADMIN,
      invoiceRowId,
      invoiceModel(),
    );

    expect(preview).toMatchObject({ blockReason: "void", creditable: 0 });
  });

  it("does not find a credit note's projection row", async () => {
    await invoiceModel().update(invoiceRowId, { documentType: "credit_note" });

    await expect(
      controller.preview(ADMIN, invoiceRowId, invoiceModel()),
    ).rejects.toMatchObject({ status: 404 });
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
    expect(createCreditNote).toHaveBeenCalledWith(
      expect.objectContaining({
        invoice: stripeInvoiceId,
        amount: 21_240,
        credit_amount: 21_240,
      }),
      { idempotencyKey: "saas-credit-note:req_1" },
    );
  });

  it("refuses more than the total less what was already credited", async () => {
    await expect(
      controller.issue(ADMIN, issueBody({ amount: 107_801 }), invoiceModel()),
    ).rejects.toMatchObject({ status: 400 });
    expect(createCreditNote).not.toHaveBeenCalled();
  });

  it("counts the credits Stripe knows of before the mirror does", async () => {
    await GetModel(CreditNoteModel, tenantId).delete(priorNoteId);
    stripeInvoice.post_payment_credit_notes_amount = 100_000;

    await expect(
      controller.issue(ADMIN, issueBody(), invoiceModel()),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("accepts exactly what is left", async () => {
    await controller.issue(
      ADMIN,
      issueBody({ amount: 107_800 }),
      invoiceModel(),
    );

    expect(createCreditNote).toHaveBeenCalledOnce();
  });

  it.each(["draft", "void", "uncollectible"] as const)(
    "refuses a %s invoice",
    async (status) => {
      stripeInvoice.status = status;

      await expect(
        controller.issue(ADMIN, issueBody(), invoiceModel()),
      ).rejects.toMatchObject({ status: 409 });
      expect(createCreditNote).not.toHaveBeenCalled();
    },
  );

  it("refuses to refund an invoice that was not paid", async () => {
    stripeInvoice.status = "open";

    await expect(
      controller.issue(ADMIN, issueBody({ mode: "refund" }), invoiceModel()),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("refuses an amount that is not a positive whole number", async () => {
    await expect(
      controller.issue(ADMIN, issueBody({ amount: 0 }), invoiceModel()),
    ).rejects.toMatchObject({ status: 400 });
    expect(retrieveInvoice).not.toHaveBeenCalled();
  });
});

describe("credit notes without a usable Stripe", () => {
  it("refuses the preview when Stripe is not configured, before any call", async () => {
    await withUnconfiguredStripe(stripe, async (unconfigured) => {
      const retrieve = vi
        .spyOn(unconfigured.write.invoices, "retrieve")
        .mockResolvedValue(fromPartial(stripeInvoice));

      await expect(
        controller.preview(ADMIN, invoiceRowId, invoiceModel()),
      ).rejects.toMatchObject({
        status: 503,
        body: "saas.errors.stripe.not_configured",
      });
      expect(retrieve).not.toHaveBeenCalled();
    });
  });

  it("refuses to issue when Stripe is not configured, before any call", async () => {
    await withUnconfiguredStripe(stripe, async (unconfigured) => {
      const retrieve = vi
        .spyOn(unconfigured.write.invoices, "retrieve")
        .mockResolvedValue(fromPartial(stripeInvoice));
      const create = vi
        .spyOn(unconfigured.write.creditNotes, "create")
        .mockResolvedValue(fromPartial({}));

      await expect(
        controller.issue(ADMIN, issueBody(), invoiceModel()),
      ).rejects.toMatchObject({
        status: 503,
        body: "saas.errors.stripe.not_configured",
      });
      expect(retrieve).not.toHaveBeenCalled();
      expect(create).not.toHaveBeenCalled();
    });
  });

  it("answers a handled 503 when Stripe refuses the key on the preview", async () => {
    retrieveInvoice.mockRejectedValueOnce(invalidKeyError());

    await expect(
      controller.preview(ADMIN, invoiceRowId, invoiceModel()),
    ).rejects.toMatchObject({
      status: 503,
      body: "saas.errors.stripe.unavailable",
    });
    expect(logs.at("ERROR")).toEqual([
      ["[dms-saas:stripe] Stripe is unavailable", expect.any(Error)],
    ]);
  });

  it("answers a handled 503 when Stripe refuses the key on issue", async () => {
    createCreditNote.mockRejectedValueOnce(invalidKeyError());

    await expect(
      controller.issue(ADMIN, issueBody(), invoiceModel()),
    ).rejects.toMatchObject({
      status: 503,
      body: "saas.errors.stripe.unavailable",
    });
    expect(logs.at("ERROR")).toEqual([
      ["[dms-saas:stripe] Stripe is unavailable", expect.any(Error)],
    ]);
  });
});
