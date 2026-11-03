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

# webhooks
