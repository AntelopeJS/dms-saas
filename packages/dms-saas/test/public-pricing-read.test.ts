import { afterEach, describe, expect, it, vi } from "vitest";
import { usePublicPricing } from "../frontend-vue/app/composables/usePublicPricing";

interface FetchOptions {
  signal: AbortSignal;
  headers?: Record<string, string>;
}

interface Handler {
  (context: {
    $authFetch: (url: string, options: FetchOptions) => unknown;
    signal: AbortSignal;
  }): unknown;
}

interface ApiDataCall {
  key: () => string;
  handler: Handler;
  options: unknown;
}

function stubReads(locale: { value: string }): ApiDataCall[] {
  const calls: ApiDataCall[] = [];
  vi.stubGlobal("useI18n", () => ({ locale }));
  vi.stubGlobal(
    "useApiData",
    (key: ApiDataCall["key"], handler: Handler, options: unknown) => {
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
    expect(calls[0]!.options).toBeUndefined();
    const fetched: string[] = [];
    const signal = new AbortController().signal;
    await calls[0]!.handler({
      $authFetch: (url) => fetched.push(url),
      signal,
    });
    expect(fetched).toEqual(["/api/saas/pricing"]);
  });

  it("reads them again in the language the visitor switches to", async () => {
    const locale = { value: "en" };
    const calls = stubReads(locale);
    usePublicPricing();

    const english = calls[0]!.key();
    locale.value = "fr";
    expect(calls[0]!.key()).not.toBe(english);
    const sent: FetchOptions[] = [];
    await calls[0]!.handler({
      $authFetch: (_url, options) => sent.push(options),
      signal: new AbortController().signal,
    });
    expect(sent[0]!.headers).toEqual({ "x-content-language": "fr" });
  });
});
