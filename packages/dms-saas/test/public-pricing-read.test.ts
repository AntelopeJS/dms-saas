import { afterEach, describe, expect, it, vi } from "vitest";
import { usePublicPricing } from "../frontend-vue/app/composables/usePublicPricing";
import { defined } from "./helpers/defined";
import type { ApiDataHandler, UseApiDataOptions } from "./helpers/api-data";
import type { ApiDataRequest } from "./helpers/api-data-request";
import { toValue } from "./helpers/vue-runtime/index.mjs";

interface FetchOptions {
  signal: AbortSignal;
  headers?: Record<string, string>;
}

interface ApiDataCall {
  key: ApiDataRequest;
  handler: ApiDataHandler<unknown>;
  options: UseApiDataOptions<unknown> | undefined;
}

function stubReads(locale: { value: string }): ApiDataCall[] {
  const calls: ApiDataCall[] = [];
  vi.stubGlobal("useI18n", () => ({ locale }));
  vi.stubGlobal(
    "useApiData",
    (
      key: ApiDataRequest,
      handler: ApiDataHandler<unknown>,
      options?: UseApiDataOptions<unknown>,
    ) => {
      calls.push({ key, handler, options });
      return { data: { value: null } };
    },
  );
  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("public pricing read", () => {
  it("reads the plans on sale with the page, server render included", async () => {
    const calls = stubReads({ value: "en" });
    usePublicPricing();

    expect(calls).toHaveLength(1);
    const read = defined(calls[0]);
    expect(read.options).toBeUndefined();
    const fetched: string[] = [];
    const signal = new AbortController().signal;
    await read.handler({
      $authFetch: (url: string) => fetched.push(url),
      signal,
    });
    expect(fetched).toEqual(["/api/saas/pricing"]);
  });

  it("reads them again in the language the visitor switches to", async () => {
    const locale = { value: "en" };
    const calls = stubReads(locale);
    usePublicPricing();

    const read = defined(calls[0]);
    const english = toValue(read.key);
    locale.value = "fr";
    expect(toValue(read.key)).not.toBe(english);
    const sent: FetchOptions[] = [];
    await read.handler({
      $authFetch: (_url: string, options: FetchOptions) => sent.push(options),
      signal: new AbortController().signal,
    });
    expect(defined(sent[0]).headers).toEqual({ "x-content-language": "fr" });
  });
});
