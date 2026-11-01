import { localeMessage, readLocale } from "./helpers/locales";
import { describe, expect, it } from "vitest";
import { INVOICE_STATUSES } from "../src/db";
import { BILLING_DOCUMENT_STATUS_ITEMS } from "../src/utils/billing-document-status";

const LOCALE_PATHS = ["saas-en-GB.json", "saas-fr-FR.json"];
const LABEL_PREFIX = "$";

const STATUS_ITEMS = BILLING_DOCUMENT_STATUS_ITEMS;

describe("billing document status labels", () => {
  it("labels every status an invoices row can hold", () => {
    const values = BILLING_DOCUMENT_STATUS_ITEMS.map((item) => item.value);

    expect(values).toEqual(expect.arrayContaining([...INVOICE_STATUSES]));
    expect(values).toContain("issued");
  });

  it.each(LOCALE_PATHS)("%s translates every status label", (path) => {
    const locale = readLocale(path);
    const untranslated = STATUS_ITEMS.filter(
      (item) =>
        localeMessage(locale, item.label.slice(LABEL_PREFIX.length)) ===
        undefined,
    );

    expect(untranslated.map((item) => item.label)).toEqual([]);
  });
});
