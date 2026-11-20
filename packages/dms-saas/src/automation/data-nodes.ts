import type { DataNodeType } from "@antelopejs/interface-dms-automation";
import { z } from "zod";
import { formatMoney } from "../plans/money";
import { automationNodeLabels } from "./labels";

const FORMAT_MONEY_NODE_ID = "saas.format-money";
const DEFAULT_LOCALE = "en-GB";

interface FormatMoneyInput {
  amountMinor: number;
  currency: string;
  locale?: string;
}

type FormatMoneyOutput = {
  text: string;
  amount: number;
};

const formatMoneyInput = z.object({
  amountMinor: z.number().int(),
  currency: z.string().regex(/^[A-Za-z]{3}$/),
  locale: z.string().min(1).default(DEFAULT_LOCALE),
});

/** The ISO 4217 minor-unit exponent of a currency: 2 for EUR, 0 for JPY. */
function minorUnitExponent(currency: string, locale: string): number {
  return (
    new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
    }).resolvedOptions().maximumFractionDigits ?? 0
  );
}

/**
 * Writes an amount in minor units as money text. The exponent is ISO
 * 4217's, which Stripe's own zero-decimal list departs from for a few
 * currencies. A currency that is not three letters or a malformed locale
 * throws.
 */
const formatMoneyNode: DataNodeType<FormatMoneyInput, FormatMoneyOutput> = {
  id: FORMAT_MONEY_NODE_ID,
  category: "string",
  ...automationNodeLabels("data", FORMAT_MONEY_NODE_ID),
  icon: "i-ph-currency-circle-dollar",
  inputSchema: {
    type: "object",
    properties: {
      amountMinor: {
        type: "integer",
        description:
          "Amount in minor units (cents), as every saas trigger carries it",
      },
      currency: {
        type: "string",
        minLength: 3,
        maxLength: 3,
        description: "ISO 4217 code, any case",
      },
      locale: {
        type: "string",
        default: DEFAULT_LOCALE,
        description: "Reader's locale, e.g. the owner's language",
      },
    },
    required: ["amountMinor", "currency"],
  },
  outputSchema: {
    type: "object",
    properties: {
      text: { type: "string", description: "Formatted amount" },
      amount: { type: "number", description: "Amount in major units" },
    },
  },
  evaluate(input) {
    const { amountMinor, currency, locale } = formatMoneyInput.parse(input);
    const code = currency.toUpperCase();
    const amount = amountMinor / 10 ** minorUnitExponent(code, locale);
    return { text: formatMoney(amount, code, locale), amount };
  },
};

export const DATA_NODES: DataNodeType[] = [formatMoneyNode];
