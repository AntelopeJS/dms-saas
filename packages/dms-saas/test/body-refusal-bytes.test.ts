import { HTTPResult, IsHTTPResult } from "@antelopejs/interface-api";
import type { User } from "@antelopejs/interface-dms/auth/db";
import { fromPartial } from "@total-typescript/shoehorn";
import { describe, expect, it } from "vitest";
import type { InvoiceModel } from "../src/db";
import { SaasBillingSettingsController } from "../src/routes/platformOwner/billing-settings";
import { SaasCreditNotesIssueController } from "../src/routes/platformOwner/credit-notes-issue";

const ADMIN = fromPartial<User>({ _id: "user_1" });

async function refusal(
  attempt: () => Promise<object>,
): Promise<[number, string, string]> {
  try {
    await attempt();
  } catch (thrown: unknown) {
    expect(thrown).toBeInstanceOf(HTTPResult);
    if (IsHTTPResult(thrown)) {
      return [thrown.getStatus(), thrown.getContentType(), thrown.getBody()];
    }
  }
  throw new Error("not refused");
}

describe("a body the platform owner routes refuse", () => {
  it("answers the credit note refusal as zod's issues in JSON", async () => {
    const controller = new SaasCreditNotesIssueController();

    expect(
      await refusal(() =>
        controller.issue(
          ADMIN,
          { invoiceId: "", amount: 0, mode: "nope" },
          fromPartial<InvoiceModel>({}),
        ),
      ),
    ).toEqual([
      400,
      "application/json",
      '[{"origin":"string","code":"too_small","minimum":1,"inclusive":true,"path":["invoiceId"],"message":"Too small: expected string to have >=1 characters"},{"origin":"number","code":"too_small","minimum":0,"inclusive":false,"path":["amount"],"message":"$saas.errors.credit_note.amount_positive"},{"code":"invalid_value","values":["credit_to_balance","refund","reduce_amount_due"],"path":["mode"],"message":"Invalid option: expected one of \\"credit_to_balance\\"|\\"refund\\"|\\"reduce_amount_due\\""},{"code":"invalid_value","values":["service_issue","billing_error","duplicate","goodwill","fraudulent","other"],"path":["reason"],"message":"Invalid option: expected one of \\"service_issue\\"|\\"billing_error\\"|\\"duplicate\\"|\\"goodwill\\"|\\"fraudulent\\"|\\"other\\""},{"expected":"string","code":"invalid_type","path":["requestId"],"message":"Invalid input: expected string, received undefined"}]',
    ]);
  });

  it("answers the billing rules refusal as zod's issues in JSON", async () => {
    const controller = new SaasBillingSettingsController();

    expect(
      await refusal(() =>
        controller.update(ADMIN, {
          autoSuspendDelayDays: 0,
          moneyBackGuaranteeMode: "nope",
        }),
      ),
    ).toEqual([
      400,
      "application/json",
      '[{"origin":"number","code":"too_small","minimum":1,"inclusive":true,"path":["autoSuspendDelayDays"],"message":"$saas.errors.billing_rules.suspension_days"},{"code":"invalid_value","values":["full","prorated"],"path":["moneyBackGuaranteeMode"],"message":"Invalid option: expected one of \\"full\\"|\\"prorated\\""}]',
    ]);
  });
});
