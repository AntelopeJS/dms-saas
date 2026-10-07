import { defineComponent, h, resolveComponent } from "vue";
import { billingDocumentTypeKey } from "../composables/useBillingDocumentType";
import { parseInvoiceLines } from "../composables/useInvoiceLines";
import { formatMinorUnits } from "../composables/useMoneyFormat";

const InvoiceLinesDisplay = defineComponent({
  name: "InvoiceLinesDisplay",
  props: {
    modelValue: {
      type: [Array, String] as unknown as () => unknown,
      default: null,
    },
  },
  setup(props) {
    const lines = resolveComponent("DmsSaasInvoiceLines");
    return () => h(lines, { modelValue: props.modelValue });
  },
});

function rowCurrency(row: unknown): string | null {
  const currency = (row as { currency?: unknown } | undefined)?.currency;
  return typeof currency === "string" && currency ? currency : null;
}

const PERIOD_FORMAT: Intl.DateTimeFormatOptions = {
  month: "long",
  year: "numeric",
};

export default defineDmsPlugin(() => {
  const { registerDataType } = useDataTypes();
  const nuxtApp = useDmsApp();
  registerDataType({
    id: "billing_document_type",
    formatter: {
      default: (value: unknown) => {
        const key = billingDocumentTypeKey(value);
        return key ? nuxtApp.$i18n.t(key) : "—";
      },
    },
  });
  registerDataType({
    id: "billing_period",
    formatter: {
      default: (value: unknown, locale: string) =>
        formatDate(value, locale, PERIOD_FORMAT) ?? "—",
    },
  });
  registerDataType({
    id: "money_cents",
    // A table hands the formatter its row: an amount reads in the row's own
    // `currency` when the row lists one, the platform currency otherwise.
    formatter: {
      default: (
        value: unknown,
        locale: string,
        _options?: unknown,
        row?: unknown,
      ) =>
        typeof value === "number"
          ? formatMinorUnits(value, rowCurrency(row), locale)
          : value,
    },
  });
  registerDataType({
    id: "invoice_lines",
    displayComponent: InvoiceLinesDisplay,
    formatter: {
      default: (value: unknown) => {
        const count = parseInvoiceLines(value).length;
        return count ? String(count) : "—";
      },
    },
  });
});
