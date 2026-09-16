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
      default: (value: unknown) =>
        nuxtApp.$i18n.t(billingDocumentTypeKey(value)),
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
    // The row currency is not part of a data-type formatter's contract, so the
    // table falls back to the platform currency; per-row currencies are only
    // rendered where the block reads the row itself.
    formatter: {
      default: (value: unknown, locale: string) =>
        typeof value === "number" ? formatMinorUnits(value, null, locale) : value,
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
