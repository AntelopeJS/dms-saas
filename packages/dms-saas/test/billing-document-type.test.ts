import { describe, expect, it } from "vitest";
import { billingDocumentTypeKey } from "../frontend-vue/app/composables/useBillingDocumentType";

describe("billing document type rendering", () => {
  it("renders mirrored credit notes as credit notes", () => {
    expect(billingDocumentTypeKey("credit_note")).toBe(
      "saas.invoices.type.credit_note",
    );
  });

  it("renders legacy and current invoice rows as invoices", () => {
    expect(billingDocumentTypeKey("invoice")).toBe(
      "saas.invoices.type.invoice",
    );
    expect(billingDocumentTypeKey(undefined)).toBe(
      "saas.invoices.type.invoice",
    );
  });
});
