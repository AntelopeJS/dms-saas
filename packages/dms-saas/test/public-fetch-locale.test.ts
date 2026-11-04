import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  onPublicLocaleChange,
  usePublicFetch,
} from "../frontend-vue/app/build/public/usePublicFetch";
import { nextTick, ref } from "./helpers/vue-runtime/index.mjs";

interface FetchRequestContext {
  options: { headers?: HeadersInit };
}

interface CreatedFetchOptions {
  baseURL: string;
  onRequest: (context: FetchRequestContext) => void;
}

const locale = ref("en");
let created: CreatedFetchOptions | undefined;

function requestHeaders(): Headers {
  const context: FetchRequestContext = { options: {} };
  created?.onRequest(context);
  return new Headers(context.options.headers);
}

beforeEach(() => {
  locale.value = "en";
  created = undefined;
  vi.stubGlobal("useI18n", () => ({ locale }));
  vi.stubGlobal("useDmsRuntimeConfig", () => ({
    public: { dms: { baseURL: "http://api.test" } },
  }));
  vi.stubGlobal("$fetch", {
    create: (options: CreatedFetchOptions) => {
      created = options;
      return vi.fn();
    },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("public fetch", () => {
  it("asks the API in the locale of each request, not of its creation", () => {
    usePublicFetch();
    expect(requestHeaders().get("x-content-language")).toBe("en");

    locale.value = "fr";

    expect(requestHeaders().get("x-content-language")).toBe("fr");
  });

  it("reloads a screen's data when the reader switches language", async () => {
    const reload = vi.fn();
    onPublicLocaleChange(reload);
    await nextTick();
    expect(reload).not.toHaveBeenCalled();

    locale.value = "fr";
    await nextTick();

    expect(reload).toHaveBeenCalledTimes(1);
  });
});
