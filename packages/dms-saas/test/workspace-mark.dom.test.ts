import { mount } from "@vue/test-utils";
import { nextTick } from "vue";
import { afterEach, describe, expect, it, vi } from "vitest";
import WorkspaceMark from "../frontend-vue/app/build/WorkspaceMark.vue";

describe("WorkspaceMark", () => {
  afterEach(() => vi.restoreAllMocks());

  it("shows the initial when the logo failed before the component mounted", async () => {
    vi.spyOn(HTMLImageElement.prototype, "complete", "get").mockReturnValue(
      true,
    );
    vi.spyOn(HTMLImageElement.prototype, "naturalWidth", "get").mockReturnValue(
      0,
    );
    const mark = mount(WorkspaceMark, {
      props: { name: "acme", logoUrl: "/broken.png" },
    });
    await nextTick();
    expect(mark.find("img").exists()).toBe(false);
    expect(mark.text()).toBe("A");
  });

  it("keeps the logo while it is still loading", () => {
    vi.spyOn(HTMLImageElement.prototype, "complete", "get").mockReturnValue(
      false,
    );
    const mark = mount(WorkspaceMark, {
      props: { name: "acme", logoUrl: "/slow.png" },
    });
    expect(mark.find("img").exists()).toBe(true);
  });
});
