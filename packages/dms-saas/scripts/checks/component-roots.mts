import { readdirSync, readFileSync } from "node:fs";

const COMPONENTS_DIRECTORY = new URL(
  "../../frontend-vue/app/components/",
  import.meta.url,
);
const CONDITIONAL_DIRECTIVES = ["v-if", "v-else-if", "v-else"] as const;
const FOLLOWING_BRANCHES = new Set<string>(["v-else-if", "v-else"]);
const OPTS_OUT_OF_ATTRIBUTES =
  /defineOptions\(\{\s*inheritAttrs:\s*false\s*\}\)/;
const TEMPLATE = /^<template>([\s\S]*)^<\/template>/m;
const COMMENT = /<!--[\s\S]*?-->/g;
/** A tag, its attributes (quoted values may hold `>`) and whether it closes itself. */
const TAG =
  /<(\/?)([A-Za-z][\w.-]*)((?:\s+[^\s=>/]+(?:=(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*(\/?)>/g;
const VOID_ELEMENTS = new Set(["br", "hr", "img", "input", "meta", "link"]);

/** The attributes of the template's root elements, one string per root. */
function rootAttributes(source: string): string[] {
  const template = TEMPLATE.exec(source)?.[1]?.replace(COMMENT, "") ?? "";
  const roots: string[] = [];
  let depth = 0;
  for (const [
    ,
    closing,
    name = "",
    attributes,
    selfClosing,
  ] of template.matchAll(TAG)) {
    if (closing) {
      depth -= 1;
      continue;
    }
    if (depth === 0) roots.push(attributes ?? "");
    if (!selfClosing && !VOID_ELEMENTS.has(name.toLowerCase())) depth += 1;
  }
  return roots;
}

function conditionalOf(attributes: string): string | undefined {
  return CONDITIONAL_DIRECTIVES.find((directive) =>
    new RegExp(`(^|\\s)${directive}(=|\\s|$)`).test(attributes),
  );
}

/**
 * Whether a component template can draw more than one root node at once: two
 * roots or more, unless they form one `v-if` / `v-else-if` / `v-else` chain.
 */
export function rendersFragment(source: string): boolean {
  const roots = rootAttributes(source);
  const [first, ...rest] = roots.map(conditionalOf);
  const isOneChain =
    first === "v-if" &&
    rest.every(
      (branch) => branch !== undefined && FOLLOWING_BRANCHES.has(branch),
    );
  return roots.length > 1 && !isOneChain;
}

/**
 * A page block receives the DMS's own attributes (`page-id`, `component-id`,
 * `child-count`, `route-params`). A component drawing several root nodes
 * cannot inherit them, and Vue warns on every page showing it unless the
 * component opts out with `defineOptions({ inheritAttrs: false })`.
 */
export function componentRootFailures(): string[] {
  const components = readdirSync(COMPONENTS_DIRECTORY).filter((file) =>
    file.endsWith(".vue"),
  );
  if (components.length === 0)
    return ["frontend-vue/app/components holds no component"];
  return components
    .filter((file) => {
      const source = readFileSync(new URL(file, COMPONENTS_DIRECTORY), "utf8");
      return rendersFragment(source) && !OPTS_OUT_OF_ATTRIBUTES.test(source);
    })
    .map(
      (file) =>
        `frontend-vue/app/components/${file} draws several roots without defineOptions({ inheritAttrs: false })`,
    );
}
