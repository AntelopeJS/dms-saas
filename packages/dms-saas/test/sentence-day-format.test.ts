import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  LABEL_DAY_FORMAT,
  SENTENCE_DAY_FORMAT,
} from "../frontend-vue/app/build/day-formats";
import { LOCALES, writeText } from "./helpers/composed-text";

interface SentenceDayUse {
  key: string;
  /** The params the component fills with a day, the others get a word. */
  dayParams: string[];
}

const DAY = new Date("2026-10-11T12:00:00.000Z");
const FILLER = "Pro";
const DOUBLE_STOP = "..";

/** Every sentence that writes a day without its year. */
const SENTENCE_DAY_USES: SentenceDayUse[] = [
  {
    key: "saas.tenant_billing.past_due.summary_with_date",
    dayParams: ["date"],
  },
  { key: "saas.tenant_billing.past_due.next_retry", dayParams: ["date"] },
  { key: "saas.tenant_billing.past_due.suspend_warning", dayParams: ["date"] },
  ...[
    "downgrade_description",
    "scheduled",
    "trial",
    "cancel_any_time",
    "renewal",
  ].map((name) => ({
    key: `saas.tenant_billing.plan_change.review.${name}`,
    dayParams: ["date"],
  })),
  {
    key: "saas.tenant_billing.plan_change.review.trial_description",
    dayParams: ["trialEnd"],
  },
  {
    key: "saas.tenant_billing.plan_change.checkout.trial_description",
    dayParams: ["date"],
  },
  {
    key: "saas.tenant_billing.plan_change.checkout.first_charge",
    dayParams: ["date"],
  },
  {
    key: "saas.workspace.data_export.finished.description",
    dayParams: ["date"],
  },
  {
    key: "saas.workspace.data_export.finished.partial_description",
    dayParams: ["date"],
  },
  {
    key: "saas.workspace.data_export.in_progress.requested",
    dayParams: ["day"],
  },
];

/** The components writing those sentences, by the source they live in. */
const SENTENCE_DAY_SOURCES = [
  "components/PastDueAlert.vue",
  "build/PlanChangeReview.vue",
  "components/PlanUpgradeModal.vue",
  "components/DataExport.vue",
];

function sourceOf(path: string): string {
  return readFileSync(
    new URL(`../frontend-vue/app/${path}`, import.meta.url),
    "utf8",
  );
}

const OTHER_PARAM = /\{\s*\w+\s*\}/g;

function dayIn(code: string): string {
  return new Intl.DateTimeFormat(code, SENTENCE_DAY_FORMAT).format(DAY);
}

function written(use: SentenceDayUse, code: string): string {
  const params = Object.fromEntries(
    use.dayParams.map((name) => [name, dayIn(code)]),
  );
  return writeText({ key: use.key, params }, code).replace(OTHER_PARAM, FILLER);
}

describe("days written in sentences", () => {
  it("spell the month out, as the French abbreviation ends with a dot", () => {
    expect(
      new Intl.DateTimeFormat("fr-FR", SENTENCE_DAY_FORMAT).format(DAY),
    ).toBe("11 octobre");
    expect(new Intl.DateTimeFormat("fr-FR", LABEL_DAY_FORMAT).format(DAY)).toBe(
      "11 oct.",
    );
  });

  it.each(
    LOCALES.flatMap((code) =>
      SENTENCE_DAY_USES.map((use) => [code, use.key, use] as const),
    ),
  )("%s %s never ends on a doubled full stop", (code, _key, use) => {
    const sentence = written(use, code);

    expect(sentence).toContain(dayIn(code));
    expect(sentence).not.toContain(DOUBLE_STOP);
  });

  it.each(SENTENCE_DAY_SOURCES)(
    "%s writes its sentence days in full",
    (path) => {
      expect(sourceOf(path)).toContain("SENTENCE_DAY_FORMAT");
    },
  );

  it("keeps the past-due summary off the short timeline day", () => {
    const source = sourceOf("components/PastDueAlert.vue");
    const summary = source.slice(
      source.indexOf("const summary = computed"),
      source.indexOf("const timeline = computed"),
    );

    expect(summary).toContain("sentenceDay(");
    expect(summary).not.toMatch(/\bday\(/);
  });
});
