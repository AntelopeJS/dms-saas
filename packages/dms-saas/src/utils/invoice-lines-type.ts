import { CustomComponent } from "@antelopejs/interface-dms/base/custom";
import {
  DataType,
  RegisterDataType,
} from "@antelopejs/interface-dms/base/data-types";
import { z } from "zod";

const lineSchema = z.object({
  description: z.string(),
  quantity: z.number().nullable(),
  amount: z.number(),
  currency: z.string().default(""),
  periodStart: z.coerce.date().nullable(),
  periodEnd: z.coerce.date().nullable(),
});

const linesSchema = z.array(lineSchema).default([]);

/**
 * Read-only renderer for the mirrored Stripe invoice lines shown in the
 * invoice details view; values are never edited from the console.
 */
@RegisterDataType("invoice_lines")
export class InvoiceLinesType extends DataType {
  protected defaultInputComponent() {
    return CustomComponent("DmsSaasInvoiceLines").serializeSync();
  }

  getValidation() {
    return linesSchema;
  }
}
