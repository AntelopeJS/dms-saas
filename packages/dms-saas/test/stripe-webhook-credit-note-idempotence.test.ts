import { GetModel } from "@antelopejs/interface-database-decorators";
import { fromPartial } from "@total-typescript/shoehorn";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CreditNoteModel, StripeWebhookEventModel } from "../src/db";
import { dispatchStripeWebhookEvent } from "../src/stripe/webhook-dispatch";
import {
  type CreditedWorkspace,
  creditedWorkspace,
} from "./helpers/credit-notes";
import { useMongoDatabase } from "./helpers/mongo";
import { useSuiteStripe } from "./helpers/stripe";

useMongoDatabase("stripe-webhook-credit-note-idempotence");
const stripe = useSuiteStripe();

let workspace: CreditedWorkspace;

function stubCreditNoteRead() {
  return vi
    .spyOn(stripe.write.creditNotes, "retrieve")
    .mockResolvedValue(fromPartial(workspace.creditNote));
}

beforeEach(async () => {
  workspace = await creditedWorkspace();
});

describe("credit note webhook event claims", () => {
  it("processes a successful event only once", async () => {
    const retrieve = stubCreditNoteRead();

    await dispatchStripeWebhookEvent(workspace.event);
    await dispatchStripeWebhookEvent(workspace.event);

    expect(retrieve).toHaveBeenCalledOnce();
    await expect(
      GetModel(StripeWebhookEventModel).get(workspace.event.id),
    ).resolves.toMatchObject({ result: "success" });
    await expect(
      GetModel(CreditNoteModel, workspace.tenantId).findOneByStripeCreditNote(
        workspace.creditNote.id,
      ),
    ).resolves.toMatchObject({ amount: 3_600 });
  });

  it("does not replay a handler whose partial effects are uncertain", async () => {
    const retrieve = stubCreditNoteRead();
    retrieve.mockRejectedValueOnce(new Error("temporary database outage"));

    await expect(dispatchStripeWebhookEvent(workspace.event)).rejects.toThrow(
      "temporary database outage",
    );
    await expect(dispatchStripeWebhookEvent(workspace.event)).rejects.toThrow(
      "reconciliation",
    );

    expect(retrieve).toHaveBeenCalledOnce();
    await expect(
      GetModel(StripeWebhookEventModel).get(workspace.event.id),
    ).resolves.toMatchObject({ result: "reconciliation_required" });
  });
});
