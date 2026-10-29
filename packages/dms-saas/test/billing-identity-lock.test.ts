import { describe, expect, it } from "vitest";
import type { TenantBillingInfo } from "../src/db";
import { withBillingIdentityLock } from "../src/workspaces/billing-identity-lock";

interface Deferred {
  promise: Promise<void>;
  resolve: () => void;
}

function deferred(): Deferred {
  let resolve = () => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("billing identity lock", () => {
  it("lets the Stripe echo read the row only once the save has written it", async () => {
    const row: Pick<TenantBillingInfo, "companyName"> = { companyName: null };
    const stripeUpdated = deferred();
    const save = withBillingIdentityLock("tenant-a", async () => {
      await stripeUpdated.promise;
      row.companyName = "Recette SAS";
    });
    const echo = withBillingIdentityLock(
      "tenant-a",
      async () => row.companyName,
    );

    stripeUpdated.resolve();
    await save;

    await expect(echo).resolves.toBe("Recette SAS");
  });

  it("keeps the queue going after a holder fails", async () => {
    const failing = withBillingIdentityLock("tenant-b", async () => {
      throw new Error("Stripe refused the VAT number");
    });
    const next = withBillingIdentityLock("tenant-b", async () => "saved");

    await expect(failing).rejects.toThrow("Stripe refused the VAT number");
    await expect(next).resolves.toBe("saved");
  });

  it("does not hold one workspace behind another", async () => {
    const blocked = deferred();
    const slow = withBillingIdentityLock("tenant-c", () => blocked.promise);

    await expect(
      withBillingIdentityLock("tenant-d", async () => "other workspace"),
    ).resolves.toBe("other workspace");

    blocked.resolve();
    await slow;
  });
});
