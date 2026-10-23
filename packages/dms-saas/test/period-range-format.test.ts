import { describe, expect, it } from "vitest";
import {
  type DateFormatFactory,
  formatPeriodRange,
} from "../frontend-vue/app/build/period-range";

const ICU_SPACES = /[  ]/;
const START = new Date("2026-10-15T12:00:00.000Z");
const END = new Date("2026-11-15T12:00:00.000Z");
const NEXT_YEAR_END = new Date("2027-01-15T12:00:00.000Z");

/** Formatters pinned to `timeZone`, as the console's reader zone pins them. */
const inZone =
  (timeZone: string): DateFormatFactory =>
  (locale, options) =>
    new Intl.DateTimeFormat(locale, { ...options, timeZone });

describe("formatPeriodRange", () => {
  it.each(["en", "fr", "nl", "de"])(
    "writes plain spaces around the dash in %s, whatever the ICU data",
    (locale) => {
      const text = formatPeriodRange(START, END, locale);
      expect(text).not.toMatch(ICU_SPACES);
      expect(text).toContain(" – ");
    },
  );

  it("writes the French period the browser writes", () => {
    expect(formatPeriodRange(START, END, "fr", inZone("UTC"))).toBe(
      "15 oct. – 15 nov.",
    );
  });

  it("adds the years once the period spans two", () => {
    expect(
      formatPeriodRange(START, NEXT_YEAR_END, "en-GB", inZone("UTC")),
    ).toBe("15 Oct 2026 – 15 Jan 2027");
  });

  it("decides the years in the formatters' zone", () => {
    const newYearUtc = new Date("2026-12-31T23:30:00.000Z");
    const startUtc = new Date("2026-12-01T12:00:00.000Z");
    // 00:30 on 1 January in Brussels: the period spans two years there.
    expect(
      formatPeriodRange(
        startUtc,
        newYearUtc,
        "en-GB",
        inZone("Europe/Brussels"),
      ),
    ).toBe("1 Dec 2026 – 1 Jan 2027");
    expect(
      formatPeriodRange(startUtc, newYearUtc, "en-GB", inZone("UTC")),
    ).toBe("1 – 31 Dec");
  });

  it("writes the lone start when the end is unknown", () => {
    expect(formatPeriodRange(START, null, "en-GB", inZone("UTC"))).toBe(
      "15 Oct",
    );
  });
});
