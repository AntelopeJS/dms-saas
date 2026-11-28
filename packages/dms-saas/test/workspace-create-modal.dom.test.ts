import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h, ref, type Ref } from "vue";
import { useApiErrorPresenter } from "../node_modules/@antelopejs/dms/frontend-vue/layers/dms-core/app/composables/useApiErrorPresenter";
import WorkspaceCreateModal from "../frontend-vue/app/components/WorkspaceCreateModal.vue";
import { readApiErrorKey } from "../frontend-vue/app/composables/useApiErrorMessage";

const CREATE_ENDPOINT = "/api/saas/workspaces";
const LEGAL_REFUSED_KEY = "saas.errors.workspace.legal_acceptance_required";
const LEGAL_REQUIRED_KEY = "saas.public.register.error.legal_required";
const HTTP_BAD_REQUEST = 400;
/** The catalog entries the form reads, as the i18n plugin renders them. */
const TEXTS = new Map([
  [
    LEGAL_REFUSED_KEY,
    "You must accept the terms and conditions and the privacy policy.",
  ],
  [LEGAL_REQUIRED_KEY, "Tick the legal checkbox first."],
]);
/** The free plan `GET create-options` offers, which asks for no card. */
const FREE_PLAN = {
  _id: "plan-free",
  name: "Free",
  description: "",
  price: 0,
  currency: "eur",
  interval: "month",
  billingMode: "flat",
  trialDays: 0,
  maxMembers: 3,
  cardRequirement: "none",
};

type SharedState = WeakMap<object, string | number | null>;
const states = new Map<string, Ref<SharedState>>();
const fetch = vi.fn();
const onSuccess = vi.fn();
const toast = { add: vi.fn(), remove: vi.fn(), update: vi.fn() };

function translate(key: string): string {
  return TEXTS.get(key) ?? key;
}

/** What a failed `$authFetch` rejects with: the response and its body. */
function apiFailure(status: number, body: string) {
  return {
    response: new Response(JSON.stringify(body), { status }),
    data: body,
  };
}

const Slot = defineComponent({
  setup:
    (_, { slots }) =>
    () =>
      h("div", slots.default?.()),
});
/** `UFormField`: the control, then the error it is given. */
const FormField = defineComponent({
  props: { error: { type: String, default: undefined } },
  setup:
    (props, { slots }) =>
    () =>
      h("div", [
        slots.default?.(),
        props.error ? h("p", { class: "field-error" }, props.error) : null,
      ]),
});
const Button = defineComponent({
  props: {
    type: { type: String, default: "button" },
    disabled: Boolean,
    loading: Boolean,
  },
  setup:
    (props, { slots }) =>
    () =>
      h(
        "button",
        { type: props.type, disabled: props.disabled || props.loading },
        slots.default?.(),
      ),
});
const Alert = defineComponent({
  props: { description: { type: String, default: "" } },
  setup: (props) => () => h("div", { role: "alert" }, props.description),
});
const Checkbox = defineComponent({
  props: { modelValue: Boolean },
  emits: ["update:modelValue"],
  setup:
    (props, { emit, slots }) =>
    () =>
      h("label", [
        h("input", {
          type: "checkbox",
          checked: props.modelValue,
          onChange: (event: Event) =>
            emit(
              "update:modelValue",
              event.target instanceof HTMLInputElement && event.target.checked,
            ),
        }),
        slots.label?.(),
      ]),
});
const TextInput = defineComponent({
  props: {
    modelValue: { type: String, default: "" },
    id: { type: String, default: undefined },
  },
  emits: ["update:modelValue"],
  setup:
    (props, { emit }) =>
    () =>
      h("input", {
        id: props.id,
        type: "text",
        value: props.modelValue,
        onInput: (event: Event) => {
          if (event.target instanceof HTMLInputElement)
            emit("update:modelValue", event.target.value);
        },
      }),
});
const Link = defineComponent({
  props: {
    to: { type: String, default: "" },
    target: { type: String, default: undefined },
  },
  setup:
    (props, { slots }) =>
    () =>
      h("a", { href: props.to, target: props.target }, slots.default?.()),
});
/** `i18n-t`: the named slots of the message, in the message's order. */
const I18nT = defineComponent({
  props: { keypath: { type: String, default: "" } },
  setup:
    (_, { slots }) =>
    () =>
      h("span", [slots.terms_and_conditions?.(), slots.privacy_policy?.()]),
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
  vi.stubGlobal("readApiErrorKey", readApiErrorKey);
  vi.stubGlobal("useI18n", () => ({ t: translate, locale: ref("en") }));
  vi.stubGlobal("useAuthFetch", () => ({ $authFetch: fetch }));
  vi.stubGlobal("formatDate", () => "");
  vi.stubGlobal("useOnDemandRead", () => ({
    read: async () => ({ plans: [FREE_PLAN], freePerCard: null }),
  }));
  vi.stubGlobal("useCurrentUser", () => ({
    user: ref({ email: "owner@example.com" }),
  }));
  vi.stubGlobal("useMoneyFormat", () => ({ formatMajorUnits: () => "€0.00" }));
  vi.stubGlobal("usePlanPriceLabel", () => () => "Free");
  vi.stubGlobal("usePlanIntervalLabel", () => () => "month");
  vi.stubGlobal("useDmsRuntimeConfig", () => ({ public: { dmsSaas: {} } }));
  vi.stubGlobal("useStripePaymentElement", vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

async function mountForm(): Promise<VueWrapper> {
  const wrapper = mount(WorkspaceCreateModal, {
    props: { onSuccessCallback: onSuccess },
    global: {
      mocks: { $t: translate },
      stubs: {
        UAlert: Alert,
        UButton: Button,
        UCheckbox: Checkbox,
        UFormField: FormField,
        UIcon: true,
        USkeleton: true,
        DmsEmptyState: true,
        DmsFieldRow: Slot,
        DmsInputText: TextInput,
        DmsLink: Link,
        DmsStatusPill: true,
        I18nT,
      },
    },
  });
  await flushPromises();
  return wrapper;
}

function checkbox(wrapper: VueWrapper) {
  return wrapper.get<HTMLInputElement>('input[type="checkbox"]');
}

function submitButton(wrapper: VueWrapper) {
  return wrapper.get('button[type="submit"]');
}

async function fillName(wrapper: VueWrapper, name: string): Promise<void> {
  await wrapper.get('input[type="text"]').setValue(name);
}

/** Enter in the name field: the form submits whatever the button's state. */
async function pressEnter(wrapper: VueWrapper): Promise<void> {
  await wrapper.get("form").trigger("submit");
  await flushPromises();
}

describe("the legal checkbox of the Create workspace form", () => {
  it("opens unticked, with the button disabled and both documents linked in a new tab", async () => {
    const wrapper = await mountForm();

    expect(checkbox(wrapper).element.checked).toBe(false);
    expect(submitButton(wrapper).attributes("disabled")).toBeDefined();
    expect(
      wrapper
        .findAll("a")
        .map((link) => [link.attributes("href"), link.attributes("target")]),
    ).toEqual([
      ["/terms-and-conditions", "_blank"],
      ["/privacy-policy", "_blank"],
    ]);
    wrapper.unmount();
  });

  it("sends nothing while it is unticked, and says so under the checkbox", async () => {
    const wrapper = await mountForm();
    await fillName(wrapper, "Side project");

    await pressEnter(wrapper);

    expect(fetch).not.toHaveBeenCalled();
    expect(wrapper.get(".field-error").text()).toBe(
      TEXTS.get(LEGAL_REQUIRED_KEY),
    );
    await checkbox(wrapper).setValue(true);
    expect(wrapper.find(".field-error").exists()).toBe(false);
    wrapper.unmount();
  });

  it("enables the button once ticked, and sends the acceptance with the creation", async () => {
    fetch.mockResolvedValue({ tenantId: "tenant-new" });
    const wrapper = await mountForm();
    await fillName(wrapper, "Side project");

    await checkbox(wrapper).setValue(true);
    expect(submitButton(wrapper).attributes("disabled")).toBeUndefined();
    await pressEnter(wrapper);

    expect(fetch).toHaveBeenCalledWith(CREATE_ENDPOINT, {
      method: "POST",
      body: {
        workspaceName: "Side project",
        planId: FREE_PLAN._id,
        paymentMethodId: undefined,
        hasAcceptedLegal: true,
      },
    });
    expect(onSuccess).toHaveBeenCalledWith("tenant-new", "Side project");
    wrapper.unmount();
  });

  it("shows the server's refusal of the acceptance under the form", async () => {
    fetch.mockRejectedValue(apiFailure(HTTP_BAD_REQUEST, LEGAL_REFUSED_KEY));
    const wrapper = await mountForm();
    await fillName(wrapper, "Side project");
    await checkbox(wrapper).setValue(true);

    await pressEnter(wrapper);

    expect(wrapper.get('[role="alert"]').text()).toBe(
      TEXTS.get(LEGAL_REFUSED_KEY),
    );
    expect(onSuccess).not.toHaveBeenCalled();
    wrapper.unmount();
  });
});
