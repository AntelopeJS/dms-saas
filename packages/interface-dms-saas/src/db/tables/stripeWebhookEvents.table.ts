import {
  Field,
  Index,
  RegisterTable,
  Table,
} from "@antelopejs/interface-database-decorators";
import { CORE_SCHEMA_NAME } from "@antelopejs/interface-dms/constants";

export const stripeWebhookEventsTableName = "stripe_webhook_events";

export const WEBHOOK_RESULTS = [
  "pending",
  "success",
  "failed",
  "skipped",
  "reconciliation_required",
] as const;
export type WebhookResult = (typeof WEBHOOK_RESULTS)[number];

/** Processing record used to make Stripe webhooks idempotent. */
@RegisterTable(stripeWebhookEventsTableName, CORE_SCHEMA_NAME)
export class StripeWebhookEvent extends Table {
  @Field("string")
  declare _id: string;

  @Field("string")
  declare type: string;

  @Index()
  @Field("date")
  declare processedAt: Date;

  @Field("string")
  declare result: WebhookResult;

  @Field("string")
  declare errorMessage: string | null;

  @Field("string")
  declare revision?: string;
}
