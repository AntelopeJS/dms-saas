import { Controller, JSONBody, Post } from "@antelopejs/interface-api";
import { assert } from "@antelopejs/interface-api-util";
import { CROSS_INSTANCE } from "@antelopejs/interface-database";
import { Model } from "@antelopejs/interface-database-decorators";
import { AuthOwnerOnly } from "@antelopejs/interface-dms/auth";
import type { User } from "@antelopejs/interface-dms/auth/db";
import { InvoiceModel } from "../../db";
import { getStripeClient } from "../../stripe";

const HTTP_BAD_REQUEST = 400;
const HTTP_NOT_FOUND = 404;

interface IssueCreditNoteBody {
  invoiceId: string;
  amount: number;
  mode: "credit_to_balance" | "refund";
  reason: string;
}

export class SaasCreditNotesIssueController extends Controller(
  "/api/saas/credit-notes",
) {
  @Post("/issue")
  async issue(
    @AuthOwnerOnly() _user: User,
    @JSONBody() body: IssueCreditNoteBody,
    @Model(InvoiceModel, CROSS_INSTANCE) invoiceModel: InvoiceModel,
  ) {
    const invoice = await invoiceModel.get(body.invoiceId);
    assert(
      invoice && invoice.documentType !== "credit_note",
      HTTP_NOT_FOUND,
      "saas.errors.invoice.not_found",
    );
    assert(
      body.amount > 0 && body.amount <= invoice.amount,
      HTTP_BAD_REQUEST,
      "saas.errors.invoice.invalid_amount",
    );
    const stripe = getStripeClient();
    const isRefund = body.mode === "refund";
    const creditNote = await stripe.creditNotes.create({
      invoice: invoice.stripeInvoiceId,
      amount: body.amount,
      refund_amount: isRefund ? body.amount : undefined,
      credit_amount: isRefund ? undefined : body.amount,
      memo: body.reason,
      reason: "order_change",
    });
    return {
      stripeCreditNoteId: creditNote.id,
      number: creditNote.number,
    };
  }
}
