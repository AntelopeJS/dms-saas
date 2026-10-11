import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const APP_DIR = fileURLToPath(new URL("../frontend-vue/app", import.meta.url));
const VUE_EXTENSION = ".vue";
const ROWS_TAG = "FormRows";
const ROW_TAG = "FormFieldRow";
const QUOTES = new Set(['"', "'", "`"]);
const REQUIRED_ATTRIBUTE = /\s:?required(?=[\s=/>])/;
const HAS_REQUIRED_ATTRIBUTE = /\s:?has-required(?=[\s=/>])/;

interface VueSource {
  path: string;
  template: string;
}

interface RowsBlock {
  openTag: string;
  body: string;
}

function listVueFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return listVueFiles(path);
    return entry.name.endsWith(VUE_EXTENSION) ? [path] : [];
  });
}

function templateOf(source: string): string {
  const start = source.indexOf("<template");
  const end = source.lastIndexOf("</template>");
  return start === -1 ? "" : source.slice(start, end);
}

/** The end of the tag opening at `start`, past `>` inside attribute values. */
function tagEnd(template: string, start: number): number {
  let quote: string | null = null;
  for (let index = start; index < template.length; index++) {
    const char = template[index];
    if (quote) {
      if (char === quote) quote = null;
    } else if (QUOTES.has(char)) {
      quote = char;
    } else if (char === ">") {
      return index;
    }
  }
  return template.length;
}

function openTags(template: string, tag: string): string[] {
  const pattern = new RegExp(`<${tag}(?=[\\s/>])`, "g");
  return [...template.matchAll(pattern)].map((match) =>
    template.slice(match.index, tagEnd(template, match.index) + 1),
  );
}

function rowsBlocks(template: string): RowsBlock[] {
  const pattern = new RegExp(`<${ROWS_TAG}(?=[\\s/>])`, "g");
  return [...template.matchAll(pattern)].map((match) => {
    const openEnd = tagEnd(template, match.index) + 1;
    const close = template.indexOf(`</${ROWS_TAG}>`, openEnd);
    return {
      openTag: template.slice(match.index, openEnd),
      body: template.slice(openEnd, close === -1 ? undefined : close),
    };
  });
}

const isRequiredRow = (openTag: string): boolean =>
  REQUIRED_ATTRIBUTE.test(openTag.slice(ROW_TAG.length + 1));

const sources: VueSource[] = listVueFiles(APP_DIR).map((path) => ({
  path: path.slice(APP_DIR.length + 1),
  template: templateOf(readFileSync(path, "utf8")),
}));

describe("required legend of hand-built forms", () => {
  // A DMS form ends its rows with "* Required fields" whenever one of them is
  // required; a hand-built form gets it from `<FormRows has-required>` only.
  it("puts every required row in rows that draw the legend", () => {
    const missing = sources.flatMap(({ path, template }) =>
      rowsBlocks(template)
        .filter((block) => !HAS_REQUIRED_ATTRIBUTE.test(block.openTag))
        .filter((block) => openTags(block.body, ROW_TAG).some(isRequiredRow))
        .map(() => path),
    );
    expect(missing).toEqual([]);
  });

  it("draws the legend only for rows that carry the required mark", () => {
    const needless = sources.flatMap(({ path, template }) =>
      rowsBlocks(template)
        .filter((block) => HAS_REQUIRED_ATTRIBUTE.test(block.openTag))
        .filter((block) => !openTags(block.body, ROW_TAG).some(isRequiredRow))
        .map(() => path),
    );
    expect(needless).toEqual([]);
  });

  it("keeps required rows inside rows drawing the legend", () => {
    const orphaned = sources
      .filter(({ path }) => !path.endsWith(`${ROWS_TAG}${VUE_EXTENSION}`))
      .filter(({ template }) => openTags(template, ROW_TAG).some(isRequiredRow))
      .filter(({ template }) => rowsBlocks(template).length === 0)
      .map(({ path }) => path);
    expect(orphaned).toEqual([]);
  });

  // The operator picks the plan the workspaces move to before going on.
  it("marks the retire dialog's target plan as required", () => {
    const retire = sources.find(({ path }) =>
      path.endsWith("RetirePlanModal.vue"),
    );
    const targetRow = openTags(retire?.template ?? "", ROW_TAG).find((tag) =>
      tag.includes("saas.catalog.retire.move_to"),
    );
    expect(targetRow && isRequiredRow(targetRow)).toBe(true);
  });
});
