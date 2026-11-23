import { fromPartial } from "@total-typescript/shoehorn";
import { describe, expect, it } from "vitest";
import { registerAutomationNodes } from "../src/automation";
import {
  executionCtx,
  implementAutomationCatalog,
  registeredAction,
} from "./helpers/automation";
import { captureLogs } from "./helpers/logging";
import { useMongoDatabase } from "./helpers/mongo";
import { useSuiteStripe } from "./helpers/stripe";
import {
  CYCLE_END,
  CYCLE_START,
  NOW,
  previewInvoice,
  seedPreviewWorkspace,
  stripeError,
  usePreviewEnvironment,
} from "./helpers/upcoming-invoice";
import { insertTenant } from "./helpers/workspaces";

useMongoDatabase();
const stripe = useSuiteStripe();
captureLogs();
const previews = usePreviewEnvironment(stripe);
const automation = implementAutomationCatalog();
await registerAutomationNodes();
const upcomingInvoice = registeredAction(
  automation,
  "saas.get-upcoming-invoice",
);

async function previewWorkspace() {
  const workspace = await seedPreviewWorkspace();
  await insertTenant(workspace.tenantId);
  return workspace;
}

function read(tenantId: string) {
  return upcomingInvoice.execute({ tenantId }, executionCtx());
}

describe("saas.get-upcoming-invoice", () => {
  it("maps the figures Stripe priced", async () => {
    const { tenantId } = await previewWorkspace();

    await expect(read(tenantId)).resolves.toEqual({
      status: "available",
      reason: null,
      currency: "EUR",
      amountDueMinor: 3480,
      totalMinor: 3480,
      subtotalMinor: 2900,
      taxMinor: 580,
      billingDate: CYCLE_END.toISOString(),
      periodStart: CYCLE_START.toISOString(),
      periodEnd: CYCLE_END.toISOString(),
      lineCount: 1,
      computedAt: NOW.toISOString(),
    });
  });

  it("answers unavailable, without failing the step, when Stripe errs", async () => {
    const { tenantId } = await previewWorkspace();
    previews.createPreview.mockRejectedValue(stripeError("rate_limit"));

    await expect(read(tenantId)).resolves.toMatchObject({
      status: "unavailable",
      reason: "provider_error",
      totalMinor: null,
      lineCount: 0,
    });
  });

  it("prices each workspace on its own Stripe customer", async () => {
    const first = await previewWorkspace();
    const second = await previewWorkspace();
    previews.createPreview.mockImplementation(async (params) =>
      fromPartial(
        params?.customer === second.customerId
          ? previewInvoice({ amount_due: 1234 })
          : previewInvoice(),
      ),
    );

    await expect(read(first.tenantId)).resolves.toMatchObject({
      amountDueMinor: 3480,
    });
    await expect(read(second.tenantId)).resolves.toMatchObject({
      amountDueMinor: 1234,
    });
  });
});
