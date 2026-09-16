import type { Plan } from "../db";
import { getStripeClient } from "../stripe/client";
import { countOccupiedSeats } from "./seat-capacity";

const PRORATION_BEHAVIOR = "create_prorations" as const;

interface SyncStripeSeatParams {
  tenantId: string;
  plan: Pick<Plan, "billingMode">;
  stripeSubscriptionId: string | null | undefined;
  idempotencyKey: string;
  quantityOverride?: number;
}

export async function syncStripeSeatQuantity(
  params: SyncStripeSeatParams,
): Promise<void> {
  if (params.plan.billingMode !== "seat") return;
  if (!params.stripeSubscriptionId) return;
  const stripe = getStripeClient();
  const subscription = await stripe.subscriptions.retrieve(
    params.stripeSubscriptionId,
  );
  const itemId = subscription.items.data[0]?.id;
  if (!itemId) return;
  const quantity =
    params.quantityOverride ?? (await countOccupiedSeats(params.tenantId));
  await stripe.subscriptions.update(
    params.stripeSubscriptionId,
    {
      items: [{ id: itemId, quantity }],
      proration_behavior: PRORATION_BEHAVIOR,
    },
    { idempotencyKey: params.idempotencyKey },
  );
}
