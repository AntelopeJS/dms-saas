import { describe, expect, it } from "vitest";
import {
  resolveMessagesLocale,
  serverMessages,
} from "../src/i18n/server-messages";

describe("messages a route words for the reader", () => {
  it("reads the module's catalog of the requested locale", () => {
    expect(serverMessages("fr-FR").t("saas.dashboard.attention.title")).toBe(
      "À traiter",
    );
  });

  it("falls back to the same language, then to British English", () => {
    expect(resolveMessagesLocale("fr")).toBe("fr-FR");
    expect(resolveMessagesLocale("fr-CA")).toBe("fr-FR");
    expect(resolveMessagesLocale("de-DE")).toBe("en-GB");
    expect(resolveMessagesLocale(undefined)).toBe("en-GB");
  });

  it("picks the zero, one or other form on the count", () => {
    const { t } = serverMessages("en-GB");
    const key = "saas.dashboard.attention.past_due";

    expect(t(key, { count: 0 })).toBe("No workspace past due");
    expect(t(key, { count: 1 })).toBe("1 workspace past due");
    expect(t(key, { count: 3 })).toBe("3 workspaces past due");
  });

  it("fills the parameters and keeps vue-i18n literals", () => {
    const { t } = serverMessages("en-GB");

    expect(
      t("saas.dashboard.attention.named_ending", {
        name: "Globex",
        date: "3 Oct",
      }),
    ).toBe("Globex on 3 Oct");
    expect(t("saas.workspaces.operator_create.owner_email_placeholder")).toBe(
      "nina.sharp@massivedynamic.com",
    );
  });

  it("answers the key itself when no catalog knows it", () => {
    expect(serverMessages("en-GB").t("saas.nowhere.to_be_found")).toBe(
      "saas.nowhere.to_be_found",
    );
  });

  it("formats money from minor units and days for the locale", () => {
    const en = serverMessages("en-GB");
    const fr = serverMessages("fr-FR");

    expect(en.money(147_000, "eur")).toBe("€1,470.00");
    expect(fr.money(147_000, "EUR")).toBe("1\u202f470,00\u00a0€");
    expect(en.day(new Date(Date.UTC(2020, 9, 4)))).toBe("4 Oct 2020");
  });

  it("writes a composed text for a block that only takes a string", () => {
    const { compose } = serverMessages("fr-FR");

    expect(
      compose({
        key: "saas.dashboard.plans.description",
        params: {
          count: { type: "count", value: 2 },
          price: {
            key: "saas.workspaces.plan_cell.price_flat",
            params: {
              price: { type: "money", value: 2_900, currency: "EUR" },
              interval: { key: "saas.workspaces.interval.month" },
            },
          },
        },
      }),
    ).toBe("2 espaces · 29,00\u00a0€ / mois");
    expect(compose("$saas.workspaces.interval.year")).toBe("an");
    expect(compose("Acme")).toBe("Acme");
  });
});
