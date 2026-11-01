import { describe, expect, it } from "vitest";
import { rendersFragment } from "../scripts/checks/component-roots.mts";

describe("component roots", () => {
  it("tells one conditional chain from two", () => {
    const template = (body: string): string =>
      `<template>\n${body}\n</template>`;
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
