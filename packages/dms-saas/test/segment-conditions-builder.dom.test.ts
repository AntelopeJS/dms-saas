import { mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h, ref, type Ref } from "vue";
import SegmentConditionsBuilder from "../frontend-vue/app/components/SegmentConditionsBuilder.vue";

type SharedState = object | boolean | null;
const states = new Map<string, Ref<SharedState>>();
const EDITED_GROUP = { logical: "or", conditions: [] };

const Group = defineComponent({
  emits: ["update"],
  setup:
    (_, { emit }) =>
    () =>
      h("button", {
        class: "edit-rules",
        onClick: () => emit("update", EDITED_GROUP),
      }),
});

/** Rules as an older API stored them, with a condition missing its value. */
interface LegacyRules {
  logical: string;
  conditions: { field: string; operator: string }[];
}

const UNREADABLE_RULES: LegacyRules = {
  logical: "and",
  conditions: [{ field: "email", operator: "contains" }],
};

function mountBuilder(modelValue: string | LegacyRules) {
  return mount(SegmentConditionsBuilder, {
    props: { modelValue },
    global: {
      mocks: { $t: (key: string) => key },
      stubs: {
        DmsSaasSegmentConditionsGroup: Group,
        DmsSaasSegmentLogicToggle: true,
        DmsSaasSegmentWords: true,
        DmsSaasLoadFailure: true,
        UAlert: defineComponent({
          props: { title: { type: String, required: true } },
          setup: (props) => () => h("div", { class: "alert" }, props.title),
        }),
        UIcon: true,
        USkeleton: true,
      },
    },
  });
}

beforeEach(() => {
  states.clear();
  vi.stubGlobal("useDmsState", (key: string, init: () => SharedState) => {
    if (!states.has(key)) states.set(key, ref(init()));
    return states.get(key);
  });
  vi.stubGlobal("useApiData", () => ({
    data: ref({ fields: [], userFields: [], plans: [] }),
    pending: ref(false),
    status: ref("success"),
    error: ref(null),
    refresh: vi.fn(),
  }));
  vi.stubGlobal("useI18n", () => ({
    t: (key: string) => key,
    locale: ref("en"),
  }));
  vi.stubGlobal("formatDate", () => "");
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("SegmentConditionsBuilder", () => {
  it.each([
    ["a JSON string", JSON.stringify(UNREADABLE_RULES)],
    ["an object", UNREADABLE_RULES],
  ])(
    "offers no edit over stored rules it cannot read, as %s",
    (_form, stored) => {
      const builder = mountBuilder(stored);

      expect(builder.find(".edit-rules").exists()).toBe(false);
      expect(builder.find(".alert").text()).toBe(
        "saas.segments.builder.unreadable_rules",
      );
      expect(builder.emitted("update:modelValue")).toBeUndefined();
    },
  );

  it("hides the editor when the rules turn unreadable, and shows it again once they are read", async () => {
    const readable = { logical: "or", conditions: [] };
    const builder = mountBuilder(JSON.stringify(readable));

    await builder.setProps({ modelValue: JSON.stringify(UNREADABLE_RULES) });
    expect(builder.find(".edit-rules").exists()).toBe(false);
    expect(states.get("saas-segment-draft:conditions")?.value).toBeNull();

    await builder.setProps({ modelValue: JSON.stringify(readable) });
    expect(builder.find(".edit-rules").exists()).toBe(true);
    expect(states.get("saas-segment-draft:conditions")?.value).toEqual(
      readable,
    );
  });

  it("publishes the edits of rules it reads", async () => {
    const builder = mountBuilder(
      JSON.stringify({ logical: "and", conditions: [] }),
    );

    await builder.find(".edit-rules").trigger("click");

    expect(builder.find(".alert").exists()).toBe(false);
    expect(builder.emitted("update:modelValue")).toEqual([
      [JSON.stringify(EDITED_GROUP)],
    ]);
  });
});
