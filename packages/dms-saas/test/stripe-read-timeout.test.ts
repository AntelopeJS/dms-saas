import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { TenantSubscription } from "../src/db";

// A Stripe that accepts connections and never answers, as an outage looks to
// the SDK: every request runs until its timeout.
const stalled = vi.hoisted(() => ({
  port: 0,
  requests: 0,
  configs: [] as Record<string, unknown>[],
}));

vi.mock("stripe", async (importOriginal) => {
  const { default: Stripe } = await importOriginal<typeof import("stripe")>();
  class StalledStripe extends Stripe {
    constructor(key: string, config: Record<string, unknown>) {
      stalled.configs.push(config);
      super(key, {
        ...config,
        host: "127.0.0.1",
        port: stalled.port,
        protocol: "http",
      });
    }
  }
  return { default: StalledStripe };
});

vi.mock("@antelopejs/interface-core/logging", () => ({
  Logging: { Error: vi.fn(), Warn: vi.fn(), Info: vi.fn() },
}));

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
  server = createServer(() => {
    stalled.requests += 1;
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  stalled.port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
});

async function timed<T>(read: () => Promise<T>) {
  const startedAt = Date.now();
  const value = await read();
  return { value, elapsedMs: Date.now() - startedAt };
}

describe("Stripe read client", () => {
  it("bounds reads by default and leaves writes on the SDK's own settings", () => {
    stalled.configs.length = 0;
    initStripeClient(STRIPE_KEYS);

    const [writeConfig, readConfig] = stalled.configs;
    expect(writeConfig).not.toHaveProperty("timeout");
    expect(writeConfig).not.toHaveProperty("maxNetworkRetries");
    expect(readConfig).toMatchObject({
      timeout: DEFAULT_STRIPE_READ_TIMEOUT_MS,
      maxNetworkRetries: DEFAULT_STRIPE_READ_MAX_NETWORK_RETRIES,
    });
    expect(getStripeReadClient()).not.toBe(getStripeClient());
  });

  it("takes the read bounds from the configuration", () => {
    stalled.configs.length = 0;
    initStripeClient({
      ...STRIPE_KEYS,
      readTimeoutMs: 1500,
      readMaxNetworkRetries: 1,
    });

    expect(stalled.configs[1]).toMatchObject({
      timeout: 1500,
      maxNetworkRetries: 1,
    });
  });
});

describe("page reads on a stalled Stripe", () => {
  beforeAll(() => {
    initStripeClient({ ...STRIPE_KEYS, readTimeoutMs: READ_TIMEOUT_MS });
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
