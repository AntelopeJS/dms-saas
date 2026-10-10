import {
  Controller,
  Get,
  JSONBody,
  Parameter,
  Post,
} from "@antelopejs/interface-api";
import { assert, assertValidation } from "@antelopejs/interface-api-util";
import { CROSS_INSTANCE } from "@antelopejs/interface-database";
import { Model } from "@antelopejs/interface-database-decorators";
import { AuthOwnerOnly } from "@antelopejs/interface-dms/auth";
import type { User } from "@antelopejs/interface-dms/auth/db";
import type { ZodError } from "zod";
import { InvoiceModel } from "../../db";
import {
  buildCreditNoteParams,
  buildCreditNotePreview,
  type CreditNotePreview,
  type IssueCreditNoteBody,
  issueCreditNoteBodySchema,
  loadInvoice,
  resolveCreditAllowance,
} from "../../operator-billing";
import { getStripeClient } from "../../stripe";

const HTTP_BAD_REQUEST = 400;
const HTTP_CONFLICT = 409;

/** What issuing a credit note answers: the note Stripe created. */
export interface IssuedCreditNote {
  stripeCreditNoteId: string;
  number: string;
  amount: number;
  currency: string;
}

function parseBody(body: unknown): IssueCreditNoteBody {
  return assertValidation(
    body,
    (value) => issueCreditNoteBodySchema.parse(value),
    (error) => (error as ZodError).issues,
  );
}

export class SaasCreditNotesIssueController extends Controller(
  "/api/saas/credit-notes",
) {
  /** The credit note dialog's data for one invoice row. */
  @Get("/preview/:invoiceId")
  async preview(
    @AuthOwnerOnly() _user: User,
    @Parameter("invoiceId", "param") invoiceId: string,
    @Model(InvoiceModel, CROSS_INSTANCE) invoiceModel: InvoiceModel,
  ): Promise<CreditNotePreview> {
    const loaded = await loadInvoice(invoiceModel, invoiceId);
    return buildCreditNotePreview(loaded);
  }

  /**
   * Issues a credit note against a paid or open invoice, never above what is
   * left to credit: the invoice total less the credit notes already issued.
   */
  @Post("/issue")
  async issue(
    @AuthOwnerOnly() user: User,
    @JSONBody() rawBody: unknown,
    @Model(InvoiceModel, CROSS_INSTANCE) invoiceModel: InvoiceModel,
  ): Promise<IssuedCreditNote> {
    const body = parseBody(rawBody);
    const loaded = await loadInvoice(invoiceModel, body.invoiceId);
    const { allowance } = await resolveCreditAllowance(loaded);
    assert(
      !allowance.blockReason,
      HTTP_CONFLICT,
      `saas.errors.credit_note.blocked.${allowance.blockReason}`,
    );
    assert(
      allowance.modes.includes(body.mode),
      HTTP_BAD_REQUEST,
      "saas.errors.credit_note.mode_not_allowed",
    );
    assert(
      body.amount <= allowance.creditable,
      HTTP_BAD_REQUEST,
      "saas.errors.credit_note.above_creditable",
    );
    const creditNote = await getStripeClient().creditNotes.create(
      buildCreditNoteParams(loaded.invoice.stripeInvoiceId, body, user),
      { idempotencyKey: `saas-credit-note:${body.requestId}` },
    );
    return {
      stripeCreditNoteId: creditNote.id,
      number: creditNote.number,
      amount: creditNote.amount,
      currency: creditNote.currency,
    };
  }
}
