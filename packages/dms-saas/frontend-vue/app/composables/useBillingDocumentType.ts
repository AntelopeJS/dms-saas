const CREDIT_NOTE_TYPE = "credit_note";

/** Resolves the translation key for current and pre-discriminant invoice rows. */
export function billingDocumentTypeKey(value: unknown): string {
  const type = value === CREDIT_NOTE_TYPE ? CREDIT_NOTE_TYPE : "invoice";
  return `saas.invoices.type.${type}`;
}
