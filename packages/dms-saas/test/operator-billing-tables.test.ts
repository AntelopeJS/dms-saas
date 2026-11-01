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
import { isFieldGroupSerialized } from "@antelopejs/interface-dms/base";
import { isOptionRecord } from "./helpers/serialized";

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
    const form = SaasSettingsController.form.serializeSync();

    expect(form.options).toMatchObject({
      fetchUrl: "/api/saas/settings/billing",
      submitUrl: "/api/saas/settings/billing",
      saveMode: "bar",
      sectionNav: "side",
    });
    expect(form.options?.sections?.map((section) => section.id)).toEqual([
      "unpaid",
      "free",
      "tax",
      "refunds",
      "legal",
    ]);
  });

  it("reads the day counts with their unit after the field", () => {
    const form = SaasSettingsController.form.serializeSync();
    const suffixes = Object.fromEntries(
      (form.options?.fields ?? []).map((field) => {
        const options = isFieldGroupSerialized(field)
          ? undefined
          : field.component.options;
        return [field.id, isOptionRecord(options) ? options.suffix : undefined];
      }),
    );

    expect(suffixes).toMatchObject({
      autoSuspendDelayDays: "$saas.operator_billing.billing_rules.days_unit",
      dataRetentionDaysAfterCancellation:
        "$saas.operator_billing.billing_rules.days_unit",
      moneyBackGuaranteeWindowDays:
        "$saas.operator_billing.billing_rules.days_unit",
    });
    expect(suffixes.maxFreeWorkspacesPerCard).toBeUndefined();
  });

  it("groups its side navigation under Billing and Legal", () => {
    const form = SaasSettingsController.form.serializeSync();
    const groups = "$saas.operator_billing.billing_rules.nav";

    expect(
      form.options?.sections?.map((section) => [section.id, section.navGroup]),
    ).toEqual([
      ["unpaid", `${groups}.billing`],
      ["free", `${groups}.billing`],
      ["tax", `${groups}.billing`],
      ["refunds", `${groups}.billing`],
      ["legal", `${groups}.legal`],
    ]);
  });
});
