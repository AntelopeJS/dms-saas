export interface InvoiceLine {
  description: string;
  quantity: number | null;
  amount: number;
  currency?: string | null;
  periodStart: string | Date | null;
  periodEnd: string | Date | null;
}

/** The mirror stores lines as an array, but the table view hands the raw column
 * value over, which may still be its JSON form. */
export function parseInvoiceLines(raw: unknown): InvoiceLine[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw as InvoiceLine[];
  if (typeof raw !== "string") return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
