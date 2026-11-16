import {
  Hook,
  RegisterHook,
  SettleHook,
  UnregisterHook,
  UnsettleHook,
} from "@antelopejs/interface-dms/hooks";
import { afterEach, describe, expect, it, onTestFinished, vi } from "vitest";
import cron from "node-cron";
import { start, stop } from "../src";
import { setRuntimeConfig } from "../src/config";
import type { DmsSaasConfig } from "../src/types";
import { captureLogs } from "./helpers/logging";

const logs = captureLogs();

const JOB_COUNT = 10;

const ONE_MINUTE_MS = 60_000;

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
  afterEach(async () => {
    await stop();
    UnsettleHook(Hook.DATABASE_INITIALIZED);
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("leaves the Stripe plan reconciliation to the database initialized hook", async () => {
    await start();
    await stop();

    expect(logs.at("WARN")).toEqual([]);
    expect(logs.at("ERROR")).toEqual([]);
  });

  it("runs no job while the DMS has not bound its schemas", async () => {
    vi.useFakeTimers();
    setRuntimeConfig(configWith({}));
    await start();
    await vi.advanceTimersByTimeAsync(2 * ONE_MINUTE_MS);

    expect(logs.at("ERROR")).toEqual([]);
  });

  it("schedules the ten jobs once the database is initialized", async () => {
    const schedule = vi.spyOn(cron, "schedule");
    setRuntimeConfig(configWith({}));
    await start();
    expect(schedule).not.toHaveBeenCalled();

    await SettleHook(Hook.DATABASE_INITIALIZED);

    expect(schedule).toHaveBeenCalledTimes(JOB_COUNT);
  });

  it("replaces its jobs when the DMS starts again", async () => {
    setRuntimeConfig(configWith({}));
    await start();
    await SettleHook(Hook.DATABASE_INITIALIZED);
    const first = new Set(cron.getTasks().keys());
    UnsettleHook(Hook.DATABASE_INITIALIZED);
    await SettleHook(Hook.DATABASE_INITIALIZED);
    const live = [...cron.getTasks().keys()];

    expect(live).toHaveLength(JOB_COUNT);
    expect(live.filter((id) => first.has(id))).toEqual([]);
  });

  it("schedules no job after it stopped", async () => {
    const schedule = vi.spyOn(cron, "schedule");
    setRuntimeConfig(configWith({}));
    await start();
    await stop();
    await SettleHook(Hook.DATABASE_INITIALIZED);

    expect(schedule).not.toHaveBeenCalled();
  });

  it("schedules no job when it stopped while the DMS was settling the hook", async () => {
    let release = (): void => undefined;
    const earlierHandler = async (): Promise<undefined> => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return undefined;
    };
    RegisterHook(Hook.DATABASE_INITIALIZED, earlierHandler);
    onTestFinished(() => {
      UnregisterHook(Hook.DATABASE_INITIALIZED, earlierHandler);
      release();
    });
    setRuntimeConfig(configWith({}));
    await start();
    const settling = SettleHook(Hook.DATABASE_INITIALIZED);
    await stop();
    release();
    await settling;

    expect(cron.getTasks().size).toBe(0);
  });

  it("schedules the ten jobs when it starts after the DMS settled the hook", async () => {
    setRuntimeConfig(configWith({}));
    await SettleHook(Hook.DATABASE_INITIALIZED);
    await start();
    await vi.waitFor(() => {
      expect(cron.getTasks().size).toBe(JOB_COUNT);
    });
  });

  it("schedules no job when scheduledJobs is false", async () => {
    const schedule = vi.spyOn(cron, "schedule");
    setRuntimeConfig(configWith({ scheduledJobs: false }));
    await start();
    await SettleHook(Hook.DATABASE_INITIALIZED);

    expect(schedule).not.toHaveBeenCalled();
  });
});
