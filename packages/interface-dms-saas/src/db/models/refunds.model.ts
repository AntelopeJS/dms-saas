import { BasicDataModel } from "@antelopejs/interface-database-decorators";
import { Refund, refundsTableName } from "../tables/refunds.table";

/** Data access for tenant refunds. */
export class RefundModel extends BasicDataModel(Refund, refundsTableName) {
  async findOneByStripeRefund(
    stripeRefundId: string,
  ): Promise<Refund | undefined> {
    const row = await this.table
      .getAll(stripeRefundId, "stripeRefundId")
      .nth(0)
      .default(undefined)
      .run();
    return row ? RefundModel.fromDatabase(row) : undefined;
  }
}
