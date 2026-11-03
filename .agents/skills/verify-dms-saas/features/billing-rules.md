---
covers:
  - packages/dms-saas/src/routes/platformOwner/billing-settings.ts
  - packages/dms-saas/src/operator-billing/billing-rules.ts
  - packages/dms-saas/src/operator-billing/billing-settings-store.ts
  - packages/dms-saas/src/operator-billing/legal-documents-store.ts
  - packages/dms-saas/src/operator-billing/legal-versions.ts
  - packages/dms-saas/src/operator-billing/index.ts
  - packages/dms-saas/src/pages/platform/settings.ts
  - packages/dms-saas/frontend-vue/app/components/LegalDocumentRelease.vue
docs:
  - packages/dms-saas/docs/4.usage/8.billing-rules.md
---

# Billing Rules

Configuration › Billing rules & legal: every rule's range, partial saves, what reaches the public pricing facts, and the versioned legal documents.

## Sub-features

- `every-rule-is-held-to-its-documented-range`: the suspension delay, the retention, the free workspaces per card, the refund window and the tax code are held to their ranges at both ends.
- `a-save-keeps-what-it-leaves-out-and-reaches-the-public`: a partial save keeps the other rules, survives a restart, shows in the customer timeline and in the public pricing facts.
- `saving-a-legal-text-publishes-a-new-version`: each legal document has its own version, bumped only by a changed text, readable by anyone and shown on its public page.
- `only-the-platform-owner-edits-the-rules`: a workspace owner and an anonymous caller cannot read or save the billing rules.

## How to get to it (user POV)

- Modules › SaaS › Configuration › Billing rules & legal, `/api/saas/settings/billing`, `/api/saas/legal-documents`.

## Driving it with dms-control

```bash
dms-control journey "$RUN" billing-rules
```

## Gotchas

- Refusals answer 400 with the zod issue list; the message key is in the body.

## Coverage

| Documented behaviour | Journey check or reason |
| --- | --- |
| 8.billing-rules.md Unpaid invoices | range journey (days 1 to 365, retention 0 to 3650) and persistence journey; Not driven: the suspension cron |
| 8.billing-rules.md Free workspaces | range journey (0 to 100); Not driven: the per-card cap itself |
| 8.billing-rules.md Tax | range journey (txcd_ plus 8 digits); Not driven: Re-sync plans |
| 8.billing-rules.md Refund policy | range journey (window 1 to 365, full or prorated) and public facts; Not driven: the refund itself |
| 8.billing-rules.md Legal documents | legal journey: versions per document, same text not a new version, 500000-character limit, the public page |
