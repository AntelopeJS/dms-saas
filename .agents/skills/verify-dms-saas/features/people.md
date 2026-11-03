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

## How to get to it (user POV)

- Customers › Users, Customers › Segments, `/api/saas/platform-owners/*`, `/api/saas/segments/*`.

## Driving it with dms-control

```bash
dms-control journey "$RUN" people
```

## Gotchas

- Workspaces reach the segment projections once the workspace state is published; the journey republishes each new workspace through the fixture.
- Visitors are not e-mail verified, so a verified-e-mail rule matches the platform admin only.

## Coverage

| Documented behaviour | Journey check or reason |
| --- | --- |
| 5.users-and-segments.md "Users" | platform-roles journey; Not driven: the list tabs All / Platform admins / Unverified and the user detail tabs; the last-platform-admin rule is unreachable through the API, because the acting admin always counts as another admin |
| 5.users-and-segments.md "Segments" | validation and counting journeys: fields, operators, list values, And/Or, any/every, owner role, depth, evaluate now, duplicate; Not driven: the 15-minute re-evaluation, trend over 30 days, CSV export with owned_mrr, the live preview editor |
