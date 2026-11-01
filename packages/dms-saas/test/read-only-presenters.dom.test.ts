import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h, ref, Suspense, type Ref } from "vue";
import { useReadOnlyRefusal } from "../node_modules/@antelopejs/dms/frontend-vue/layers/dms-core/app/composables/useReadOnlyRefusal";
import TenantBillingForm from "../frontend-vue/app/components/TenantBillingForm.vue";
import DataExport from "../frontend-vue/app/components/DataExport.vue";
import DataExportHistory from "../frontend-vue/app/components/DataExportHistory.vue";
import { useApiErrorMessage } from "../frontend-vue/app/composables/useApiErrorMessage";
import * as billing from "../frontend-vue/app/composables/useBillingIdentity";
import { useExportHistory } from "../frontend-vue/app/composables/useExportHistory";
import { useWorkspaceActions } from "../frontend-vue/app/build/workspace-detail/useWorkspaceActions";
import { useSegmentPreview } from "../frontend-vue/app/build/segments/useSegmentPreview";
import type {
  SegmentConditionGroup,
  SegmentPreview,
} from "../frontend-vue/app/build/segments/types";

const READ_ONLY_TITLE = "Read-only demo, changes are not saved";
interface Notice {
  title: string;
}
type SharedState =
  | boolean
  | WeakSet<object>
  | SegmentConditionGroup
  | SegmentPreview
  | null;
const toast = { add: vi.fn<(notice: Notice) => void>() };
const fetch = vi.fn();
const refresh = vi.fn();
const states = new Map<string, Ref<SharedState>>();

function translate(key: string): string {
  return key === "error.read_only_demo" ? READ_ONLY_TITLE : key;
}

function refusal(marked: boolean) {
  return {
    response: new Response(null, {
      status: 403,
      headers: marked ? { "x-dms-readonly": "1" } : {},
    }),
  };
}

function rejectRequest(marked: boolean): void {
  fetch.mockImplementation(async () => {
    const error = refusal(marked);
    useReadOnlyRefusal()(error);
    throw error;
  });
}

const Slot = defineComponent({
  setup:
    (_, { slots }) =>
    () =>
      h("div", slots.default?.()),
});
const Button = defineComponent({
  setup:
    (_, { slots }) =>
    () =>
      h("button", slots.default?.()),
});
interface IdentityProps {
  modelValue: billing.BillingIdentityDraft;
}
const IdentityFields = defineComponent<IdentityProps>({
  props: ["modelValue"],
  emits: ["update:modelValue"],
  render: () => null,
});

beforeEach(() => {
  states.clear();
  vi.stubGlobal("useToast", () => toast);
  vi.stubGlobal("useDmsState", (key: string, init: () => SharedState) => {
    if (!states.has(key)) states.set(key, ref(init()));
    return states.get(key);
  });
  vi.stubGlobal("getAppTranslation", () => ({ processApiMessage: translate }));
  vi.stubGlobal("useReadOnlyRefusal", useReadOnlyRefusal);
  vi.stubGlobal("useDmsApp", () => ({
    $i18n: { t: translate, te: () => false },
  }));
  vi.stubGlobal("useI18n", () => ({ t: translate, locale: ref("en") }));
  vi.stubGlobal("useApiErrorMessage", useApiErrorMessage);
  vi.stubGlobal("useAuthFetch", () => ({ $authFetch: fetch }));
  vi.stubGlobal("refreshPageBlocks", refresh);
  vi.stubGlobal("formatDate", () => "");
  vi.stubGlobal("useOnDemandRead", () => ({ read: vi.fn() }));
  vi.stubGlobal("useDmsRoute", () => ({ query: {} }));
  vi.stubGlobal("useDmsRouter", () => ({ replace: vi.fn() }));
  vi.stubGlobal("useCurrentUser", () => ({
    user: ref({ email: "demo@example.com" }),
  }));
  vi.stubGlobal("useExportHistory", useExportHistory);
  vi.stubGlobal("useApiData", () => ({
    data: ref({
      items: [{ jobId: "old-export", status: "failed" }],
      page: 1,
      hasMore: false,
    }),
    pending: ref(false),
    status: ref("success"),
    placeholder: ref(false),
    refresh,
  }));
  for (const [name, value] of Object.entries(billing))
    vi.stubGlobal(name, value);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

function expectNotice(marked: boolean, localTitle: string): void {
  expect(toast.add.mock.calls.map(([notice]) => notice.title)).toEqual([
    marked ? READ_ONLY_TITLE : localTitle,
  ]);
}

describe("shared API error messages", () => {
  it.each([true, false])(
    "resolves a marked=%s refusal without a local message",
    (marked) => {
      const error = refusal(marked);
      useReadOnlyRefusal()(error);
      const { resolveApiError } = useApiErrorMessage();

      expect(resolveApiError(error, "local.error")).toBe(
        marked ? "" : "local.error",
      );
      expect(toast.add.mock.calls.map(([notice]) => notice.title)).toEqual(
        marked ? [READ_ONLY_TITLE] : [],
      );
    },
  );
});

describe("workspace action preparation", () => {
  it.each([true, false])("shows one notice for marked=%s", async (marked) => {
    rejectRequest(marked);
    vi.stubGlobal("useConfirm", () => ({ confirm: vi.fn() }));
    vi.stubGlobal("useConfirmFrom", () => ({ confirmFrom: fetch }));
    const actions = useWorkspaceActions("workspace-1");

    await actions.join();

    expectNotice(marked, "saas.workspace_detail.error.prepare");
    expect(refresh).not.toHaveBeenCalled();
  });
});

describe("segment preview notices", () => {
  it.each([true, false])(
    "suppresses the preview failure for marked=%s",
    async (marked) => {
      rejectRequest(marked);
      vi.stubGlobal("FormEvents", { SUBMIT_SUCCESS: "submit-success" });
      const wrapper = mount(
        defineComponent({
          setup() {
            const preview = useSegmentPreview(() => undefined);
            preview.conditions.value = {
              logical: "and",
              conditions: [{ field: "language", operator: "eq", value: "en" }],
            };
            return preview;
          },
          render: () => null,
        }),
      );

      await wrapper.vm.recount();

      expect(wrapper.vm.hasFailed).toBe(!marked);
      expect(wrapper.vm.isRecounting).toBe(false);
      expect(toast.add.mock.calls.map(([notice]) => notice.title)).toEqual(
        marked ? [READ_ONLY_TITLE] : [],
      );
      wrapper.unmount();
    },
  );
});

describe("billing refusal", () => {
  it.each([true, false])(
    "keeps the draft and clears saving for marked=%s",
    async (marked) => {
      rejectRequest(marked);
      vi.stubGlobal("useBillingStatus", () => ({
        data: ref({ isTenantOwner: true }),
      }));
      const stored = {
        customerType: "business",
        companyName: "Demo",
        billingEmail: "demo@example.com",
        address: {
          country: "BE",
          line1: "Rue X 12",
          postalCode: "1000",
          city: "Brussels",
        },
        missingFields: [],
      };
      vi.stubGlobal("useBillingInfo", () => ({
        data: ref(stored),
        pending: ref(false),
        error: ref(null),
      }));
      const wrapper = mount(
        defineComponent({
          render: () =>
            h(Suspense, null, { default: () => h(TenantBillingForm) }),
        }),
        {
          global: {
            mocks: { $t: translate },
            stubs: {
              DmsSection: Slot,
              DmsSaasBillingIdentityFields: IdentityFields,
              DmsSaveBar: true,
            },
          },
        },
      );
      await flushPromises();
      const fields = wrapper.getComponent(IdentityFields);
      fields.vm.$emit("update:modelValue", {
        ...fields.props("modelValue"),
        customerType: "individual",
      });
      await wrapper.get("form").trigger("submit");
      await flushPromises();

      expectNotice(marked, "saas.tenant_billing.billing_info.save_error");
      expect(
        wrapper.getComponent({ name: "DmsSaveBar" }).attributes("saving"),
      ).toBe("false");
      expect(fields.props("modelValue").customerType).toBe("individual");
      expect(stored.customerType).toBe("business");
      wrapper.unmount();
    },
  );
});

describe.each([DataExport, DataExportHistory])(
  "export request refusal",
  (component) => {
    it.each([true, false])(
      "clears pending without a second notice for marked=%s",
      async (marked) => {
        rejectRequest(marked);
        vi.stubGlobal("EXPORT_STATUS", {
          pending: "pending",
          failed: "failed",
          completed: "completed",
        });
        const wrapper = mount(component, {
          global: {
            mocks: { $t: translate },
            stubs: {
              DmsCard: Slot,
              DmsStatusPill: true,
              UButton: Button,
              DmsEmptyState: Slot,
            },
          },
        });
        await wrapper.get("button").trigger("click");
        await flushPromises();

        expectNotice(marked, "saas.workspace.data_export.error.start");
        expect(states.get("saas-export-starting")?.value).toBe(false);
        expect(refresh).toHaveBeenCalled();
        wrapper.unmount();
      },
    );
  },
);
