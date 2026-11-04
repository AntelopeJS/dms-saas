import { HTTPResult } from "@antelopejs/interface-api";
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
    if (thrown instanceof HTTPResult) {
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
      '[{"code":"too_small","minimum":1,"type":"string","inclusive":true,"exact":false,"message":"String must contain at least 1 character(s)","path":["invoiceId"]},{"code":"too_small","minimum":0,"type":"number","inclusive":false,"exact":false,"message":"$saas.errors.credit_note.amount_positive","path":["amount"]},{"received":"nope","code":"invalid_enum_value","options":["credit_to_balance","refund","reduce_amount_due"],"path":["mode"],"message":"Invalid enum value. Expected \'credit_to_balance\' | \'refund\' | \'reduce_amount_due\', received \'nope\'"},{"expected":"\'service_issue\' | \'billing_error\' | \'duplicate\' | \'goodwill\' | \'fraudulent\' | \'other\'","received":"undefined","code":"invalid_type","path":["reason"],"message":"Required"},{"code":"invalid_type","expected":"string","received":"undefined","path":["requestId"],"message":"Required"}]',
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
      '[{"code":"too_small","minimum":1,"type":"number","inclusive":true,"exact":false,"message":"$saas.errors.billing_rules.suspension_days","path":["autoSuspendDelayDays"]},{"received":"nope","code":"invalid_enum_value","options":["full","prorated"],"path":["moneyBackGuaranteeMode"],"message":"Invalid enum value. Expected \'full\' | \'prorated\', received \'nope\'"}]',
    ]);
  });
});
