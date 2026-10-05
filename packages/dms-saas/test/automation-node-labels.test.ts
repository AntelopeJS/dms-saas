import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

const registrations = vi.hoisted(() => ({
  triggers: vi.fn(),
  actions: vi.fn(),
}));
vi.mock("@antelopejs/interface-dms-automation", () => ({
  RegisterTriggerType: registrations.triggers,
  RegisterActionType: registrations.actions,
  UnregisterTriggerType: vi.fn(),
  UnregisterActionType: vi.fn(),
}));
vi.mock("../src/notifications", () => ({
  notifyTenantOwners: vi.fn(),
  automationNotificationSubject: {},
}));
vi.mock("../src/operator-actions", () => ({
  reactivateWorkspaceCommand: vi.fn(),
  suspendWorkspaceCommand: vi.fn(),
}));

import { registerAutomationNodes } from "../src/automation";

type LocaleTree = Record<string, unknown>;

interface CatalogNode {
  id: string;
  name: string;
  description: string;
}

const LOCALE_PATHS = ["saas-en-GB.json", "saas-fr-FR.json"];
const LABEL_PREFIX = "$saas.automation.";

function readLocale(path: string): LocaleTree {
  const url = new URL(`../frontend-vue/i18n/locales/${path}`, import.meta.url);
  return JSON.parse(readFileSync(url, "utf-8")) as LocaleTree;
}

function translate(locale: LocaleTree, label: string): unknown {
  return label
    .slice(1)
    .split(".")
    .reduce<unknown>(
      (node, segment) => (node as LocaleTree | undefined)?.[segment],
      locale,
    );
}

function registeredNodes(): CatalogNode[] {
  registerAutomationNodes();
  return [registrations.triggers, registrations.actions].flatMap((register) =>
    register.mock.calls.map(([node]) => node as CatalogNode),
  );
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
      (label) => typeof translate(locale, label) !== "string",
    );

    expect(untranslated).toEqual([]);
  });

  it("names the subscription trigger in French", () => {
    const trigger = nodes.find(
      (node) => node.id === "saas.subscription-started",
    );

    expect(translate(readLocale("saas-fr-FR.json"), trigger?.name ?? "")).toBe(
      "Abonnement démarré",
    );
  });
});
