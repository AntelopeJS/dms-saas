import { describe, expect, it } from "vitest";
import { registerAutomationNodes } from "../src/automation";
import { implementAutomationCatalog } from "./helpers/automation";

const automation = implementAutomationCatalog();
await registerAutomationNodes();

function formatMoney(amountMinor: number, currency: string, locale?: string) {
  const node = automation.dataNodes.get("saas.format-money");
  if (!node) throw new Error("saas.format-money is not registered");
  return node.evaluate({ amountMinor, currency, locale });
}

describe("saas.format-money", () => {
  it("writes a whole euro amount without decimals in the default locale", () => {
    expect(formatMoney(6_900, "eur")).toEqual({ text: "€69", amount: 69 });
  });

  it("writes cents in the reader's locale", () => {
    const { text, amount } = formatMoney(6_950, "EUR", "fr-FR");

    expect(text).toMatch(/^69,50\s€$/);
    expect(amount).toBe(69.5);
  });

  it("reads a zero-decimal currency's minor units as major units", () => {
    expect(formatMoney(500, "JPY")).toEqual({ text: "JP¥500", amount: 500 });
  });

  it("refuses a currency that is not a three-letter code", () => {
    expect(() => formatMoney(100, "EURO")).toThrow();
  });

  it("refuses a malformed locale", () => {
    expect(() => formatMoney(100, "EUR", "not a locale")).toThrow(RangeError);
  });
});
