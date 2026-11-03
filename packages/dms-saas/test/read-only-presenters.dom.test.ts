import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h, ref, Suspense, type Ref } from "vue";
import { useApiErrorPresenter } from "../node_modules/@antelopejs/dms/frontend-vue/layers/dms-core/app/composables/useApiErrorPresenter";
import TenantBillingForm from "../frontend-vue/app/components/TenantBillingForm.vue";
import DataExport from "../frontend-vue/app/components/DataExport.vue";
import DataExportHistory from "../frontend-vue/app/components/DataExportHistory.vue";
import * as billing from "../frontend-vue/app/composables/useBillingIdentity";
import { useExportHistory } from "../frontend-vue/app/composables/useExportHistory";

const READ_ONLY_TITLE = "Read-only demo, changes are not saved";
interface Notice {
  title: string;
  color: string;
}
const toast = {
  add: vi.fn((notice: Notice) => ({ ...notice, id: "failure" })),
  remove: vi.fn(),
  update: vi.fn(),
};
const fetch = vi.fn();
const refresh = vi.fn();
type SharedState = boolean | WeakMap<object, string | number | null>;
const states = new Map<string, Ref<SharedState>>();

function translate(key: string): string {
  return key === "error.read_only_demo" ? READ_ONLY_TITLE : key;
}

function rejectRequest(
  status: number,
  data: { message?: string; severity?: string },
  corePresented = false,
): void {
  fetch.mockImplementation(async () => {
    const error = {
      response: new Response(JSON.stringify(data), { status }),
      data,
    };
    if (corePresented)
      useApiErrorPresenter().presentError(error, { fallbackKey: "core.error" });
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
  vi.stubGlobal("getPluginI18n", () => ({
    i18n: { tm: (key: string) => key, rt: translate },
  }));
  vi.stubGlobal("useApiErrorPresenter", useApiErrorPresenter);
  vi.stubGlobal("useDmsApp", () => ({
    $i18n: { t: translate, te: () => false },
  }));
  vi.stubGlobal("useI18n", () => ({ t: translate, locale: ref("en") }));
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

function expectNotice(title: string, color: string): void {
  expect(
    toast.add.mock.calls.map(([notice]) => ({
      title: notice.title,
      color: notice.color,
    })),
  ).toEqual([{ title, color }]);
}

describe("billing refusal", () => {
  it("warns about incomplete local billing details without sending a request", async () => {
    vi.stubGlobal("useBillingStatus", () => ({
      data: ref({ isTenantOwner: true }),
    }));
    vi.stubGlobal("useBillingInfo", () => ({
      data: ref(null),
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
    await wrapper.get("form").trigger("submit");
    await flushPromises();

    expectNotice(
      "saas.tenant_billing.billing_info.incomplete_toast",
      "warning",
    );
    expect(fetch).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it.each([false, true])(
    "preserves the draft with one warning, corePresented=%s",
    async (corePresented) => {
      rejectRequest(
        403,
        { message: "error.read_only_demo", severity: "warning" },
        corePresented,
      );
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

      expectNotice(READ_ONLY_TITLE, "warning");
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
  "export request failure",
  (component) => {
    it.each([
      {
        status: 403,
        data: { message: "error.read_only_demo", severity: "warning" },
        title: READ_ONLY_TITLE,
        color: "warning",
        corePresented: false,
      },
      {
        status: 403,
        data: { message: "error.read_only_demo", severity: "warning" },
        title: READ_ONLY_TITLE,
        color: "warning",
        corePresented: true,
      },
      {
        status: 422,
        data: {},
        title: "saas.workspace.data_export.error.start",
        color: "warning",
        corePresented: false,
      },
      {
        status: 503,
        data: {},
        title: "saas.workspace.data_export.error.start",
        color: "error",
        corePresented: false,
      },
      {
        status: 503,
        data: { message: "error.read_only_demo", severity: "info" },
        title: READ_ONLY_TITLE,
        color: "info",
        corePresented: false,
      },
    ])(
      "shows one $color notice for $status, corePresented=$corePresented",
      async ({ status, data, title, color, corePresented }) => {
        rejectRequest(status, data, corePresented);
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

        expectNotice(title, color);
        expect(states.get("saas-export-starting")?.value).toBe(false);
        expect(refresh).toHaveBeenCalled();
        wrapper.unmount();
      },
    );
  },
);
