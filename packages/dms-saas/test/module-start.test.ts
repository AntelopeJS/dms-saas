import { describe, expect, it } from "vitest";
import { start, stop } from "../src";
import { captureLogs } from "./helpers/logging";

const logs = captureLogs();

describe("module start", () => {
  it("leaves the Stripe plan reconciliation to the database initialized hook", async () => {
    await start();
    await stop();

    expect(logs.at("WARN")).toEqual([]);
    expect(logs.at("ERROR")).toEqual([]);
  });
});
