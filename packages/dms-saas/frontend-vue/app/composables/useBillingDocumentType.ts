const BILLING_DOCUMENT_TYPE_KEYS: Record<string, string> = {
  invoice: "saas.invoices.type.invoice",
  credit_note: "saas.invoices.type.credit_note",
};

/** Resolves the translation key of a billing document type, if it is known. */
export function billingDocumentTypeKey(value: unknown): string | null {
  return typeof value === "string"
    ? (BILLING_DOCUMENT_TYPE_KEYS[value] ?? null)
    : null;
}
