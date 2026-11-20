import { localeMessage, readLocale } from "./helpers/locales";
import { describe, expect, it } from "vitest";
import { registerAutomationNodes } from "../src/automation";
import { armTrigger, implementAutomationCatalog } from "./helpers/automation";
import { captureLogs } from "./helpers/logging";

const catalog = implementAutomationCatalog();
const logs = captureLogs();

const LOCALE_PATHS = ["saas-en-GB.json", "saas-fr-FR.json"];
const LABEL_PREFIX = "$saas.automation.";

async function registeredNodes() {
  await registerAutomationNodes();
  return [...catalog.triggers.values(), ...catalog.actions.values()];
}

const nodes = await registeredNodes();
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

  it.each([
    ["saas-en-GB.json", "Workspace deleted (deprecated)"],
    ["saas-fr-FR.json", "Espace de travail supprimé (obsolète)"],
  ])("%s names saas.tenant-deleted as deprecated", (path, name) => {
    const trigger = catalog.triggers.get("saas.tenant-deleted");

    expect(
      localeMessage(readLocale(path), (trigger?.name ?? "").slice(1)),
    ).toBe(name);
  });

  it("warns once each time a procedure arms saas.tenant-deleted", async () => {
    await armTrigger(catalog, "saas.tenant-deleted");

    expect(logs.at("WARN")).toEqual([
      [
        "[dms-saas:automation] saas.tenant-deleted is deprecated; use dms.tenant-deleted",
      ],
    ]);
  });
});
