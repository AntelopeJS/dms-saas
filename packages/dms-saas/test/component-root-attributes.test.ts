import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// A page block receives the DMS's own attributes (`page-id`,
// `component-id`, `child-count`, `route-params`). A component drawing several
// root nodes cannot inherit them, and Vue warns on every page showing it
// unless the component says it does not want them.

const COMPONENTS_DIR = new URL(
  "../frontend-vue/app/components/",
  import.meta.url,
);
const CONDITIONAL_DIRECTIVES = ["v-if", "v-else-if", "v-else"] as const;
const FOLLOWING_BRANCHES = new Set(["v-else-if", "v-else"]);
const OPTS_OUT_OF_ATTRIBUTES =
  /defineOptions\(\{\s*inheritAttrs:\s*false\s*\}\)/;
const TEMPLATE = /^<template>([\s\S]*)^<\/template>/m;
const COMMENT = /<!--[\s\S]*?-->/g;
// A tag, its attributes (quoted values may hold `>`) and whether it closes
// itself.
const TAG =
  /<(\/?)([A-Za-z][\w.-]*)((?:\s+[^\s=>/]+(?:=(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*(\/?)>/g;
const VOID_ELEMENTS = new Set(["br", "hr", "img", "input", "meta", "link"]);

/** The attributes of the template's root elements, one string per root. */
function rootAttributes(source: string): string[] {
  const template = TEMPLATE.exec(source)?.[1]?.replace(COMMENT, "") ?? "";
  const roots: string[] = [];
  let depth = 0;
  for (const [, closing, name, attributes, selfClosing] of template.matchAll(
    TAG,
  )) {
    if (closing) {
      depth -= 1;
      continue;
    }
    if (depth === 0) roots.push(attributes ?? "");
    if (!selfClosing && !VOID_ELEMENTS.has(name!.toLowerCase())) depth += 1;
  }
  return roots;
}

function conditionalOf(attributes: string): string | undefined {
  return CONDITIONAL_DIRECTIVES.find((directive) =>
    new RegExp(`(^|\\s)${directive}(=|\\s|$)`).test(attributes),
  );
}

/** Whether the template can draw more than one root node at once. */
function rendersFragment(source: string): boolean {
  const roots = rootAttributes(source);
  const [first, ...rest] = roots.map(conditionalOf);
  const isOneChain =
    first === "v-if" &&
    rest.every(
      (branch) => branch !== undefined && FOLLOWING_BRANCHES.has(branch),
    );
  return roots.length > 1 && !isOneChain;
}

const components = readdirSync(COMPONENTS_DIR)
  .filter((file) => file.endsWith(".vue"))
  .map((file) => ({
    file,
    source: readFileSync(new URL(file, COMPONENTS_DIR), "utf8"),
  }));

describe("component roots", () => {
  it("finds the components", () => {
    expect(components.length).toBeGreaterThan(0);
  });

  it("keeps the attributes off a component drawing several roots", () => {
    const warned = components
      .filter(({ source }) => rendersFragment(source))
      .filter(({ source }) => !OPTS_OUT_OF_ATTRIBUTES.test(source))
      .map(({ file }) => file);
    expect(warned).toEqual([]);
  });

  it("tells one conditional chain from two", () => {
    const template = (body: string) => `<template>\n${body}\n</template>`;
    expect(rendersFragment(template('<a v-if="x" /><b v-else />'))).toBe(false);
    expect(rendersFragment(template('<a v-if="x" /><b v-if="y" />'))).toBe(
      true,
    );
    expect(rendersFragment(template("<a /><b />"))).toBe(true);
    expect(
      rendersFragment(template('<div :class="a > b"><p v-if="x" /></div>')),
    ).toBe(false);
  });
});
