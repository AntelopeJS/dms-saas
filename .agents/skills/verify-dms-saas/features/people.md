---
covers:
  - packages/dms-saas/src/routes/platformOwner/users-detail.ts
  - packages/dms-saas/src/routes/platformOwner/platform-owners.ts
  - packages/dms-saas/src/routes/platformOwner/segments.ts
  - packages/dms-saas/src/routes/platformOwner/segments-export.ts
  - packages/dms-saas/src/users/**
  - packages/dms-saas/src/segments/**
  - packages/dms-saas/src/crons/recompute-segments.ts
  - packages/dms-saas/src/pages/platform/users/**
  - packages/dms-saas/src/pages/platform/segments/**
  - packages/dms-saas/src/data-api/platformOwner/users.ts
  - packages/dms-saas/src/data-api/platformOwner/segments.ts
  - packages/dms-saas/src/data-api/platformOwner/admin-user-*.ts
  - packages/dms-saas/frontend-vue/app/components/Segment*.vue
  - packages/dms-saas/frontend-vue/app/components/UserSummaryCard.vue
  - packages/dms-saas/frontend-vue/app/components/UserSegmentMatches.vue
  - packages/dms-saas/frontend-vue/app/components/UserPlatformRoleCard.vue
  - packages/dms-saas/frontend-vue/app/build/segments/**
  - packages/dms-saas/frontend-vue/app/build/users/**
  - packages/dms-saas/frontend-vue/app/plugins/segment-conditions-data-type.ts
docs:
  - packages/dms-saas/docs/4.usage/5.users-and-segments.md
---

# People

Customers › Users and Segments: promoting and demoting platform admins, and the rule-based user segments.

## Sub-features

- `platform-admin-roles-follow-their-rules`: promoting and demoting follow the documented rules: no double promotion, no self-demotion, no demoting a non-admin, and only a platform admin acts.
- `a-segment-rejects-malformed-rules`: a segment needs a name of at most 120 characters, a description of at most 500, known fields, their operators, a list for in and nin, and a depth of at most 8.
- `a-segment-counts-the-users-its-rules-match`: rules on e-mail and on workspaces match the right users with And and Or, evaluate now refreshes the count, and a duplicate is its own segment.
- `the-all-and-platform-admins-tabs-list-exactly-their-accounts`: All lists every account and Platform admins only the admins, each tab with its count.
- `the-unverified-tab-lists-the-accounts-whose-address-is-not-verified`: accounts that registered and never verified their e-mail address are listed under Unverified, which counts them.
- `the-segment-export-writes-one-row-per-matching-user-with-owned-mrr`: the CSV has the documented header, one row per matching user sorted by e-mail, and owned_mrr sums the MRR of the workspaces the user owns.

## How to get to it (user POV)

- Customers › Users, Customers › Segments, `/api/saas/platform-owners/*`, `/api/saas/segments/*`.

## Driving it with dms-control

```bash
dms-control journey "$RUN" people
```

## Gotchas

- Workspaces reach the segment projections once the workspace state is published; the journey republishes each new workspace through the fixture.
- Visitors are not e-mail verified, so a verified-e-mail rule matches the platform admin only.
- Known finding: `the-unverified-tab-lists-the-accounts-whose-address-is-not-verified` fails. `POST /register` (`createInitialUser` in `routes/public/register.ts`) stores the user without `isValidated`, and the users table of `@antelopejs/interface-dms` has no default, so the Unverified tab (`isValidated is "false"`) and the Unverified badge (`equals: false`) skip every account that registered and never verified: the tab reads "Unverified 0".

## Coverage

| Documented behaviour | Journey check or reason |
| --- | --- |
| 5.users-and-segments.md "Users" (promote and demote) | platform-roles journey; Not driven: the user detail tabs; the last-platform-admin rule is unreachable through the API, because the acting admin always counts as another admin |
| 5.users-and-segments.md "Segments" | validation and counting journeys: fields, operators, list values, And/Or, any/every, owner role, depth, evaluate now, duplicate; Not driven: the 15-minute re-evaluation, trend over 30 days, the live preview editor |
| 5.users-and-segments.md Users tabs | tab journeys: All and Platform admins; the Unverified journey fails on a product finding (see Gotchas) |
| 5.users-and-segments.md Export users (CSV) and owned_mrr | CSV journey: header, rows sorted by e-mail, owned_mrr 50.00 and 0.00 |
