import { localeMessage, readLocale } from "./helpers/locales";
import { describe, expect, it } from "vitest";
import { registerAutomationNodes } from "../src/automation";
import { implementAutomationCatalog } from "./helpers/automation";

const catalog = implementAutomationCatalog();

const LOCALE_PATHS = ["saas-en-GB.json", "saas-fr-FR.json"];
const LABEL_PREFIX = "$saas.automation.";

function registeredNodes() {
  registerAutomationNodes();
  return [...catalog.triggers.values(), ...catalog.actions.values()];
}

const nodes = registeredNodes();
const labels = nodes.flatMap((node) => [node.name, node.description]);

describe("automation catalog labels", () => {
  it("registers every trigger and action label as a locale key", () => {
    expect(nodes.length).toBeGreaterThan(0);
    expect(labels.filter((label) => !label.startsWith(LABEL_PREFIX))).toEqual(
      [],
    );
  });

  it.each(LOCALE_PATHS)("%s translates every catalog label", (path) => {
    const locale = readLocale(path);
    const untranslated = labels.filter(
      (label) => localeMessage(locale, label.slice(1)) === undefined,
    );

    expect(untranslated).toEqual([]);
  });

  it("names the subscription trigger in French", () => {
    const trigger = nodes.find(
      (node) => node.id === "saas.subscription-started",
    );

    expect(
      localeMessage(
        readLocale("saas-fr-FR.json"),
        (trigger?.name ?? "").slice(1),
      ),
    ).toBe("Abonnement démarré");
  });
});
