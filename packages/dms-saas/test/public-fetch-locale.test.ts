import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  onPublicLocaleChange,
  usePublicFetch,
} from "../frontend-vue/app/build/public/usePublicFetch";

interface FetchRequestContext {
  options: { headers?: HeadersInit };
}

interface CreatedFetchOptions {
  baseURL: string;
  onRequest: (context: FetchRequestContext) => void;
}

const watchers = vi.hoisted(() => [] as Array<() => void>);

vi.mock("../frontend-vue/node_modules/vue/index.mjs", () => ({
  watch: (_source: unknown, callback: () => void) => {
    watchers.push(callback);
  },
}));

const locale = { value: "en" };
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

  it("reloads a screen's data when the reader switches language", () => {
    const reload = vi.fn();
    onPublicLocaleChange(reload);

    for (const callback of watchers) callback();

    expect(reload).toHaveBeenCalledTimes(1);
  });
});
