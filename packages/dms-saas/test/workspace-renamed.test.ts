import { afterEach, describe, expect, it, vi } from "vitest";
import { useWorkspaceRenamed } from "../frontend-vue/app/composables/useWorkspaceRenamed";

// Mounted at once; the unmount hook is kept for the test to run.
const unmount: Array<() => void> = [];
vi.mock("../frontend-vue/node_modules/vue/index.mjs", () => ({
  onMounted: (hook: () => void) => hook(),
  onBeforeUnmount: (hook: () => void) => unmount.push(hook),
}));

const SUBMIT_SUCCESS = "DmsComponent.Form.SubmitSuccess";

/** A form's success event, as the DMS form dispatches it on `window`. */
function formSaved(submitUrl: string, response: unknown): CustomEvent {
  return new CustomEvent(SUBMIT_SUCCESS, {
    detail: { data: { data: { name: " Renamed " }, response, submitUrl } },
  });
}

function setup() {
  const target = new EventTarget();
  vi.stubGlobal("window", target);
  vi.stubGlobal("FormEvents", { SUBMIT_SUCCESS });
  const onRenamed = vi.fn();
  useWorkspaceRenamed(onRenamed);
  return { target, onRenamed };
}

afterEach(() => {
  unmount.splice(0).forEach((hook) => hook());
  vi.unstubAllGlobals();
});

describe("workspace renamed", () => {
  it("hands over the rename's answer, the name as stored", () => {
    const { target, onRenamed } = setup();
    const answer = { _id: "workspace-1", name: "Renamed" };

    target.dispatchEvent(formSaved("/api/saas/workspaces/current", answer));

    expect(onRenamed).toHaveBeenCalledExactlyOnceWith(answer);
  });

  it("ignores the other forms, and stops once unmounted", () => {
    const { target, onRenamed } = setup();

    target.dispatchEvent(formSaved("/api/saas/tenant/billing-info", {}));
    unmount.splice(0).forEach((hook) => hook());
    target.dispatchEvent(
      formSaved("/api/saas/workspaces/current", { _id: "w", name: "n" }),
    );

    expect(onRenamed).not.toHaveBeenCalled();
  });
});
