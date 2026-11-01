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
import { ZodError } from "zod";
import { InvoiceModel } from "../../db";
import {
  buildCreditNoteParams,
  buildCreditNotePreview,
  type CreditNotePreview,
  type IssueCreditNoteBody,
  issueCreditNoteBodySchema,
  type LoadedInvoice,
  loadInvoice,
  resolveCreditAllowance,
} from "../../operator-billing";
import { getStripeClient } from "../../stripe";
import {
  assertStripeConfigured,
  withStripeAvailability,
} from "../../stripe/availability";
import { zodIssuesJson } from "../../utils/zod-json";

const HTTP_BAD_REQUEST = 400;
const HTTP_CONFLICT = 409;

/** What issuing a credit note answers: the note Stripe created. */
export interface IssuedCreditNote {
  stripeCreditNoteId: string;
  number: string;
  amount: number;
  currency: string;
}

/** Checks what is left to credit with Stripe, then has Stripe issue the note. */
async function issueAgainst(
  loaded: LoadedInvoice,
  body: IssueCreditNoteBody,
  user: User,
): Promise<IssuedCreditNote> {
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

export class SaasCreditNotesIssueController extends Controller(
  "/api/saas/credit-notes",
) {
  /**
   * The credit note dialog's data for one invoice row. It reads the invoice
   * from Stripe, so Stripe being unusable answers 503 with a translated reason.
   */
  @Get("/preview/:invoiceId")
  async preview(
    @AuthOwnerOnly() _user: User,
    @Parameter("invoiceId", "param") invoiceId: string,
    @Model(InvoiceModel, CROSS_INSTANCE) invoiceModel: InvoiceModel,
  ): Promise<CreditNotePreview> {
    assertStripeConfigured();
    const loaded = await loadInvoice(invoiceModel, invoiceId);
    return withStripeAvailability(() => buildCreditNotePreview(loaded));
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
    const body = assertValidation(
      rawBody,
      (value) => issueCreditNoteBodySchema.parse(value),
      (error) =>
        error instanceof ZodError ? zodIssuesJson(error.issues) : undefined,
    );
    assertStripeConfigured();
    const loaded = await loadInvoice(invoiceModel, body.invoiceId);
    return withStripeAvailability(() => issueAgainst(loaded, body, user));
  }
}
