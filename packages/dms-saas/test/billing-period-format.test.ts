import { describe, expect, it } from "vitest";
import {
  BILLING_PERIOD_SEPARATOR,
  type BillingPeriodFormatters,
  formatBillingPeriod,
} from "../frontend-vue/app/composables/useBillingPeriod";

const READER_ZONE = "Europe/Brussels";
const PERIOD_START = new Date("2026-10-08T10:00:00Z");
const PERIOD_END = new Date("2026-11-08T10:00:00Z");

/** What the DMS regional formatters do: every date in the reader's zone. */
function formattersIn(
  timeZone: string,
  locale = "fr",
): BillingPeriodFormatters {
  return {
    formatDay: (date, options) =>
      new Intl.DateTimeFormat(locale, { ...options, timeZone }).format(date),
    dayKey: (date) =>
      new Intl.DateTimeFormat("en-CA", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(date),
  };
}

describe("billing period cell", () => {
  // Node's ICU put thin spaces (U+2009) around the dash and the browser's
  // plain ones: every workspace page with invoices failed to hydrate.
  it("joins the bounds with plain spaces, whatever the runtime's ICU", () => {
    const text = formatBillingPeriod(
      PERIOD_START,
      PERIOD_END,
      formattersIn(READER_ZONE),
    );

    expect(text).toBe("8 oct. – 8 nov.");
    expect(text).toContain(BILLING_PERIOD_SEPARATOR);
    expect(text).not.toMatch(/[\u2009\u202f]/);
  });

  it("writes the days the reader's zone falls on", () => {
    const start = new Date("2026-10-07T23:30:00Z");

    expect(
      formatBillingPeriod(
        start,
        PERIOD_END,
        formattersIn(READER_ZONE, "en-GB"),
      ),
    ).toBe("8 Oct – 8 Nov");
  });

  it("names both years once the period spans two in the reader's zone", () => {
    const start = new Date("2026-12-31T23:30:00Z");
    const end = new Date("2027-01-31T23:30:00Z");

    expect(formatBillingPeriod(start, end, formattersIn("UTC", "en-GB"))).toBe(
      "31 Dec 2026 – 31 Jan 2027",
    );
    expect(
      formatBillingPeriod(start, end, formattersIn(READER_ZONE, "en-GB")),
    ).toBe("1 Jan – 1 Feb");
  });

  it("writes a period without an end as its first day", () => {
    expect(
      formatBillingPeriod(
        PERIOD_START,
        null,
        formattersIn(READER_ZONE, "en-GB"),
      ),
    ).toBe("8 Oct");
  });
});
