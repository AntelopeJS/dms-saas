import https from "node:https";
import {
  type AddressInfo,
  createServer,
  type Server,
  type Socket,
} from "node:net";
import Stripe from "stripe";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { TenantSubscription } from "../src/db";

/**
 * A Stripe that accepts connections and never answers, as an outage looks to
 * the SDK: no TLS handshake completes, so every request runs until its
 * timeout. `requests` counts the connections the SDK opened.
 */
const stalled = { port: 0, requests: 0, sockets: new Set<Socket>() };

const sendHttps = https.request.bind(https);

/**
 * Sends the SDK's HTTPS requests to the stalled server instead. The SDK calls
 * `request` on the `https` module object for every request, which is where an
 * HTTP fake such as nock intercepts it.
 */
function routeStripeToStalledServer(): void {
  vi.spyOn(https, "request").mockImplementation(
    (options: https.RequestOptions, callback) =>
      sendHttps(
        { ...options, host: "127.0.0.1", port: stalled.port, agent: false },
        callback,
      ),
  );
}

import { fetchDefaultPaymentMethod } from "../src/billing-state/recovery";
import {
  DEFAULT_STRIPE_READ_MAX_NETWORK_RETRIES,
  DEFAULT_STRIPE_READ_TIMEOUT_MS,
  fetchPrimaryTaxId,
  fetchScheduledCancellation,
  getStripeClient,
  getStripeReadClient,
  initStripeClient,
} from "../src/stripe";
import { priceUpcomingInvoice } from "../src/upcoming-invoice/pricing";

const READ_TIMEOUT_MS = 100;
/** Far below the SDK's 80 s default, with room for a slow CI machine. */
const BOUNDED_WAIT_MS = 2000;
const STRIPE_KEYS = {
  secretKey: "sk_test_key",
  webhookSecret: "whsec_test",
  publishableKey: "pk_test",
};

let server: Server;

beforeAll(async () => {
  server = createServer((socket) => {
    stalled.requests += 1;
    stalled.sockets.add(socket);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  stalled.port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  for (const socket of stalled.sockets) socket.destroy();
  await new Promise((resolve) => server.close(resolve));
});

async function timed<T>(read: () => Promise<T>) {
  const startedAt = Date.now();
  const value = await read();
  return { value, elapsedMs: Date.now() - startedAt };
}

describe("Stripe read client", () => {
  it("bounds reads by default and leaves writes on the SDK's own settings", () => {
    initStripeClient(STRIPE_KEYS);
    const sdkDefaults = new Stripe(STRIPE_KEYS.secretKey);

    for (const field of ["timeout", "maxNetworkRetries"] as const)
      expect(getStripeClient().getApiField(field)).toBe(
        sdkDefaults.getApiField(field),
      );
    expect(getStripeReadClient().getApiField("timeout")).toBe(
      DEFAULT_STRIPE_READ_TIMEOUT_MS,
    );
    expect(getStripeReadClient().getApiField("maxNetworkRetries")).toBe(
      DEFAULT_STRIPE_READ_MAX_NETWORK_RETRIES,
    );
    expect(getStripeReadClient()).not.toBe(getStripeClient());
  });

  it("takes the read bounds from the configuration", () => {
    initStripeClient({
      ...STRIPE_KEYS,
      readTimeoutMs: 1500,
      readMaxNetworkRetries: 1,
    });

    expect(getStripeReadClient().getApiField("timeout")).toBe(1500);
    expect(getStripeReadClient().getApiField("maxNetworkRetries")).toBe(1);
  });
});

describe("page reads on a stalled Stripe", () => {
  beforeAll(() => {
    initStripeClient({ ...STRIPE_KEYS, readTimeoutMs: READ_TIMEOUT_MS });
    routeStripeToStalledServer();
  });

  it("renders the billing status without the card once the read times out", async () => {
    stalled.requests = 0;
    const { value, elapsedMs } = await timed(() =>
      fetchDefaultPaymentMethod("cus_a"),
    );

    expect(value).toBeNull();
    expect(elapsedMs).toBeLessThan(BOUNDED_WAIT_MS);
    expect(stalled.requests).toBe(1);
  });

  it("renders the billing status without the scheduled cancellation", async () => {
    const { value, elapsedMs } = await timed(() =>
      fetchScheduledCancellation("sub_a"),
    );

    expect(value).toBeNull();
    expect(elapsedMs).toBeLessThan(BOUNDED_WAIT_MS);
  });

  it("keeps the stored VAT check when Stripe does not answer", async () => {
    const { value, elapsedMs } = await timed(() => fetchPrimaryTaxId("cus_a"));

    expect(value).toEqual({ reachable: false, taxId: null });
    expect(elapsedMs).toBeLessThan(BOUNDED_WAIT_MS);
  });

  it("reports the next invoice unavailable rather than failing", async () => {
    const { value, elapsedMs } = await timed(() =>
      priceUpcomingInvoice(
        "tenant-a",
        {
          subscription: { _id: "tenant-a" } as TenantSubscription,
          customerId: "cus_a",
          subscriptionId: "sub_a",
        },
        new Date(),
      ),
    );

    expect(value).toMatchObject({
      status: "unavailable",
      reason: "provider_error",
    });
    expect(elapsedMs).toBeLessThan(BOUNDED_WAIT_MS);
  });
});
