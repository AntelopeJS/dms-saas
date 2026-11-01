import { ImplementInterface } from "@antelopejs/interface-core";
import * as clientBaseUrlInterface from "@antelopejs/interface-dms/client-base-url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setDevMode } from "../src/config/dev-mode";
import { isAllowedRedirectUrl, setRuntimeConfig } from "../src/config/runtime";
import type { DmsSaasConfig } from "../src/types";

const STRIPE_CONFIG = {
  secretKey: "sk_test",
  webhookSecret: "whsec_test",
  publishableKey: "pk_test",
};

/** The client URL the DMS answers `GetClientBaseUrl` with. */
let clientBaseUrl: string | undefined;

ImplementInterface(clientBaseUrlInterface, {
  GetClientBaseUrl: async () => clientBaseUrl,
});

const CONFIGURED_HOST = "app.example.com";
const CLIENT_HOST = "dashboard.example.com:8443";

const LOOPBACK_URLS = [
  "http://localhost:3000/billing",
  "http://localhost:3006/billing",
  "http://127.0.0.1:5173/",
  "http://[::1]:4000/return",
  "https://localhost:8443/",
];

const LOOKALIKE_URLS = [
  "http://localhost.evil.com:3000/",
  "https://evil.com/?u=http://localhost:3000",
  "http://localhost@evil.com/",
  "ftp://localhost:3000/",
  "javascript:alert(1)",
  "localhost:3000",
  "not a url",
  "",
];

function configure(allowedRedirectHosts?: string[]): void {
  const config: DmsSaasConfig = { stripe: STRIPE_CONFIG, allowedRedirectHosts };
  setRuntimeConfig(config);
}

describe("redirect URL validation", () => {
  beforeEach(() => {
    configure(undefined);
    setDevMode(false);
    clientBaseUrl = undefined;
  });

  afterEach(() => {
    setDevMode(false);
  });

  it("accepts a configured host", async () => {
    configure([CONFIGURED_HOST]);

    expect(
      await isAllowedRedirectUrl(`https://${CONFIGURED_HOST}/return`),
    ).toBe(true);
  });

  it("rejects an unconfigured host", async () => {
    configure([CONFIGURED_HOST]);

    expect(await isAllowedRedirectUrl("https://evil.com/return")).toBe(false);
  });

  it("defaults to the host of the DMS client URL", async () => {
    clientBaseUrl = `https://${CLIENT_HOST}`;

    expect(await isAllowedRedirectUrl(`https://${CLIENT_HOST}/billing`)).toBe(
      true,
    );
    expect(
      await isAllowedRedirectUrl("https://dashboard.example.com/billing"),
    ).toBe(false);
    expect(await isAllowedRedirectUrl("https://evil.com/billing")).toBe(false);
  });

  it("prefers the configured hosts over the DMS client URL", async () => {
    clientBaseUrl = `https://${CLIENT_HOST}`;
    configure([CONFIGURED_HOST]);

    expect(await isAllowedRedirectUrl(`https://${CONFIGURED_HOST}/`)).toBe(
      true,
    );
    expect(await isAllowedRedirectUrl(`https://${CLIENT_HOST}/`)).toBe(false);
  });

  it("rejects everything when nothing is configured", async () => {
    expect(
      await isAllowedRedirectUrl(`https://${CONFIGURED_HOST}/return`),
    ).toBe(false);
  });

  it("rejects non-http protocols even for a configured host", async () => {
    configure(["localhost:3000"]);

    expect(await isAllowedRedirectUrl("ftp://localhost:3000/")).toBe(false);
  });

  it("rejects loopback hosts outside of dev mode", async () => {
    for (const url of LOOPBACK_URLS) {
      expect(await isAllowedRedirectUrl(url), url).toBe(false);
    }
  });

  it("accepts loopback hosts in dev mode without configuration", async () => {
    setDevMode(true);

    for (const url of LOOPBACK_URLS) {
      expect(await isAllowedRedirectUrl(url), url).toBe(true);
    }
  });

  it("still honours the configured hosts in dev mode", async () => {
    setDevMode(true);
    configure([CONFIGURED_HOST]);

    expect(
      await isAllowedRedirectUrl(`https://${CONFIGURED_HOST}/return`),
    ).toBe(true);
  });

  it("rejects urls that only look like loopback ones in dev mode", async () => {
    setDevMode(true);

    for (const url of LOOKALIKE_URLS) {
      expect(await isAllowedRedirectUrl(url), url).toBe(false);
    }
  });

  it("rejects non-loopback hosts in dev mode when not configured", async () => {
    setDevMode(true);

    expect(await isAllowedRedirectUrl("https://evil.com/return")).toBe(false);
  });
});
