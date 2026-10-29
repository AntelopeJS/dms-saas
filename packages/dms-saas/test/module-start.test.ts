import { describe, expect, it } from "vitest";
import { start, stop } from "../src";
import { captureLogs } from "./helpers/logging";

const logs = captureLogs();

describe("module start", () => {
  // DMS registers its database schemas in its own start(), which may run
  // after this one: the plan reconciliation waits for DATABASE_INITIALIZED.
  it("leaves the Stripe plan reconciliation to the database initialized hook", async () => {
    await start();
    await stop();

    expect(logs.at("WARN")).toEqual([]);
    expect(logs.at("ERROR")).toEqual([]);
  });
});
