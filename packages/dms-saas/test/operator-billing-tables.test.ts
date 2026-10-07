import { describe, expect, it } from "vitest";
import {
  creditNoteIssuer,
  creditNoteMemo,
  creditNoteReason,
} from "../src/data-api/platformOwner/credit-note-rows";
import { invoiceSeats } from "../src/data-api/platformOwner/invoice-rows";
import { CREDIT_NOTE_METADATA } from "../src/operator-billing";
import {
  INVOICE_ROW_ACTIONS,
  SaasInvoicesController,
} from "../src/pages/platform/invoices";
import { SaasSettingsController } from "../src/pages/platform/settings";
import { AUTO_PRORATA_METADATA_KEY } from "../src/stripe/webhook-handlers";

describe("operator invoices table", () => {
  it("offers a credit note on paid and open invoices only", () => {
    const issue = INVOICE_ROW_ACTIONS.find(
      (action) => action.target.type === "modal",
    );

    expect(issue?.rule).toEqual({ field: "isCreditable", equals: true });
  });

  it("names its blocks for the roles editor", () => {
    expect(SaasInvoicesController.stats.metadata).toMatchObject({
      name: "$saas.permissions.billing.invoice_stats",
      description: "$saas.permissions.billing.invoice_stats_description",
    });
  });

  it("bills the seats of the largest charged line", () => {
    const line = {
      description: "",
      currency: "eur",
      periodStart: null,
      periodEnd: null,
    };
    expect(
      invoiceSeats([
        { ...line, quantity: 23, amount: 112_700 },
        { ...line, quantity: 30, amount: -500 },
      ]),
    ).toBe(23);
    expect(invoiceSeats([{ ...line, quantity: 1, amount: 2_900 }])).toBeNull();
  });
});

describe("operator credit notes table", () => {
  it("words why a credit note was issued", () => {
    expect(
      creditNoteReason({
        metadata: { [CREDIT_NOTE_METADATA.reason]: "goodwill" },
        reason: "",
      }),
    ).toBe("goodwill");
    expect(
      creditNoteReason({
        metadata: { [AUTO_PRORATA_METADATA_KEY]: "sub_1" },
        reason: "order_change",
      }),
    ).toBe("prorated_cancellation");
    expect(
      creditNoteReason({ metadata: {}, reason: "product_unsatisfactory" }),
    ).toBe("service_issue");
    expect(creditNoteReason({ metadata: {}, reason: "" })).toBeNull();
  });

  it("names the operator who issued it, none for an automatic one", () => {
    expect(
      creditNoteIssuer({
        metadata: {
          [CREDIT_NOTE_METADATA.issuedBy]: "user_1",
          [CREDIT_NOTE_METADATA.issuedByName]: "Camille Laurent",
        },
      }),
    ).toBe("Camille Laurent");
    expect(creditNoteIssuer({ metadata: {} })).toBeNull();
  });

  it("shows the internal memo before Stripe's", () => {
    expect(
      creditNoteMemo({
        metadata: { [CREDIT_NOTE_METADATA.internalMemo]: "Agreed with Maria" },
        memo: "Printed",
      }),
    ).toBe("Agreed with Maria");
    expect(creditNoteMemo({ metadata: {}, memo: "Printed" })).toBe("Printed");
  });
});

describe("billing rules & legal page", () => {
  it("is one form, saved at once, its sections listed beside it", () => {
    const form = SaasSettingsController.form.serializeSync() as {
      options: Record<string, unknown> & { sections: { id: string }[] };
    };

    expect(form.options).toMatchObject({
      fetchUrl: "/api/saas/settings/billing",
      submitUrl: "/api/saas/settings/billing",
      saveMode: "bar",
      sectionNav: "side",
    });
    expect(form.options.sections.map((section) => section.id)).toEqual([
      "unpaid",
      "free",
      "tax",
      "refunds",
      "legal",
    ]);
  });
});
