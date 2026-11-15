import { afterEach, describe, expect, it, vi } from "vitest";
import cron from "node-cron";
import { start, stop } from "../src";
import { setRuntimeConfig } from "../src/config";
import type { DmsSaasConfig } from "../src/types";
import { captureLogs } from "./helpers/logging";

const logs = captureLogs();

const JOB_COUNT = 10;

function configWith(overrides: Partial<DmsSaasConfig>): DmsSaasConfig {
  return {
    stripe: {
      secretKey: "sk_test_x",
      webhookSecret: "whsec_x",
      publishableKey: "pk_test_x",
    },
    ...overrides,
  };
}

describe("module start", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("leaves the Stripe plan reconciliation to the database initialized hook", async () => {
    await start();
    await stop();

    expect(logs.at("WARN")).toEqual([]);
    expect(logs.at("ERROR")).toEqual([]);
  });

  it("schedules the ten jobs by default", async () => {
    const schedule = vi.spyOn(cron, "schedule");
    setRuntimeConfig(configWith({}));
    await start();
    await stop();

    expect(schedule).toHaveBeenCalledTimes(JOB_COUNT);
  });

  it("schedules no job when scheduledJobs is false", async () => {
    const schedule = vi.spyOn(cron, "schedule");
    setRuntimeConfig(configWith({ scheduledJobs: false }));
    await start();
    await stop();

    expect(schedule).not.toHaveBeenCalled();
  });
});
