---
covers:
  - packages/dms-saas/src/routes/public/webhooks/**
  - packages/dms-saas/src/stripe/webhook-*.ts
  - packages/dms-saas/src/stripe/payload-shapes.ts
  - packages/dms-saas/src/stripe/customer-*.ts
  - packages/dms-saas/src/crons/auto-suspend-past-due.ts
  - packages/dms-saas/src/crons/expire-free-workspaces.ts
  - packages/dms-saas/src/crons/hard-delete-cancelled.ts
  - packages/dms-saas/src/crons/cleanup-stripe-webhook-events.ts
  - packages/dms-saas/src/crons/register.ts
  - packages/dms-saas/src/crons/notify-free-workspaces-ending-soon.ts
  - packages/dms-saas/src/crons/reconcile-workspace-lifecycle.ts
  - packages/dms-saas/src/crons/subscription-notifications.ts
  - packages/dms-saas/src/crons/recompute-billing-state.ts
  - packages/dms-saas/src/crons/index.ts
  - packages/dms-saas/src/crons/reconcile-invoice-line-injections.ts
  - packages/dms-saas/src/crons/reconcile-guarded-downgrades.ts
  - packages/dms-saas/src/notifications/**
docs:
  - packages/dms-saas/docs/7.stripe.md
  - packages/dms-saas/docs/8.operations.md
  - packages/dms-saas/docs/6.faq.md
---

# Webhooks

The Stripe webhook endpoint and the module's own schedules: signature verification, admission and deduplication of events, the events the module ignores, and events for customers no workspace holds.

## Sub-features

- `a-delivery-needs-a-valid-signature`: an unsigned, wrongly signed or stale delivery is refused with 400 and admits nothing, a correctly signed one is received.
- `an-event-the-module-does-not-handle-is-recorded-skipped-once`: an unhandled event type is acknowledged and recorded as skipped, and a redelivery of the same event id changes nothing.
- `an-event-for-an-unknown-customer-moves-no-workspace`: a handled event that names a Stripe customer no workspace holds is acknowledged and never ends in reconciliation.

## How to get to it (user POV)

- `POST /api/saas/webhooks/stripe` with a signed body (`deliverEvent`).

## Driving it with dms-control

```bash
dms-control journey "$RUN" webhooks
```

## Gotchas

- The endpoint secret of the run is `whsec_placeholder`, which still verifies signatures.
- The tolerance for the signature timestamp is Stripe's five minutes.

## Coverage

| Documented behaviour | Journey check or reason |
| --- | --- |
| 7.stripe.md "Stripe API version and webhooks" | delivery journeys: signature, skipped events, deduplication, unknown customer; Not driven: each handled event's effect on a workspace, because most handlers read Stripe back |
| 7.stripe.md "What moves a workspace's billing state" | Not driven: the crons (01:00 suspension, 02:00 complimentary end, 04:30 deletion, every minute guarded downgrade, every 15 minutes directory) cannot be advanced by the harness and the module owns its clock |
| 8.operations.md "Stripe webhooks" | Not driven: reconciliation_required on a failed handler, the 04:00 cleanup of events older than 90 days |
| 6.faq.md "A trial ended, but the workspace still shows it as trialing" | Not driven: needs a trial the harness cannot end |
