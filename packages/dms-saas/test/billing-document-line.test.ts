import { describe, expect, it } from "vitest";
import { billingDocumentLine } from "../src/utils/billing-document-type";
import { missingKeys, writeText } from "./helpers/composed-text";

describe("billing document line", () => {
  it("names the document's type under its number", () => {
    expect(writeText(billingDocumentLine({ documentType: "invoice" }))).toBe(
      "Invoice",
    );
    expect(
      writeText(billingDocumentLine({ documentType: "credit_note" }), "fr-FR"),
    ).toBe("Avoir");
  });

  it("names the invoice a credit note credits", () => {
    const line = billingDocumentLine({
      documentType: "credit_note",
      parentInvoiceNumber: "INV-0042",
    });

    expect(writeText(line)).toBe("Credit note · for INV-0042");
    expect(writeText(line, "fr-FR")).toBe("Avoir · pour INV-0042");
    expect(missingKeys(line, "fr-FR")).toEqual([]);
  });
});
