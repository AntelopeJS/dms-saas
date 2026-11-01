import { HTTPResult } from "@antelopejs/interface-api";
import { describe, expect, it } from "vitest";
import { PlanChangeIncompatibleError } from "../src/plan-changes/guarded-free";
import { planChangeResponse } from "../src/routes/tenant/tenant-plan-ops";

describe("a plan change the workspace's inventory refuses", () => {
  it("answers 409 with its incompatibilities in the bytes the billing page reads", async () => {
    const refusal = await planChangeResponse(() =>
      Promise.reject(
        new PlanChangeIncompatibleError([
          { code: "seats", message: "saas.errors.plan.seats", resource: "3" },
          { code: "storage", message: "saas.errors.plan.storage" },
        ]),
      ),
    ).catch((error: unknown) => error);

    expect(refusal).toBeInstanceOf(HTTPResult);
    if (!(refusal instanceof HTTPResult)) return;
    expect([
      refusal.getStatus(),
      refusal.getContentType(),
      refusal.getBody(),
    ]).toEqual([
      409,
      "application/json",
      '{"code":"saas.errors.plan.incompatible","incompatibilities":[{"code":"seats","message":"saas.errors.plan.seats","resource":"3"},{"code":"storage","message":"saas.errors.plan.storage"}]}',
    ]);
  });
});
