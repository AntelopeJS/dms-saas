---
covers:
  - packages/dms-saas/src/auth/plan-permissions-resolver.ts
  - packages/dms-saas/src/auth/owner-only-permissions-resolver.ts
  - packages/dms-saas/src/auth/subscription-access-gate.ts
  - packages/dms-saas/src/auth/index.ts
  - packages/dms-saas/src/plans/seat-*.ts
  - packages/dms-saas/src/plans/feature-guards.ts
  - packages/dms-saas/src/plans/platform-support.ts
  - packages/dms-saas/src/pages/tenant/members-seat-quota.ts
  - packages/dms-saas/src/pages/tenant/owner-only.ts
  - packages/dms-saas/src/pages/tenant/workspace-suspended.ts
  - packages/dms-saas/frontend-vue/app/components/WorkspaceSuspended.vue
  - packages/dms-saas/frontend-vue/app/components/SeatQuotaBanner.vue
  - packages/dms-saas/frontend-vue/app/composables/useSeatQuota.ts
  - packages/dms-saas/frontend-vue/app/composables/useSubscriptionAccess.ts
  - packages/dms-saas/frontend-vue/app/composables/useSaasStatus.ts
docs:
  - packages/dms-saas/docs/5.extending.md
  - packages/dms-saas/docs/4.usage/2.workspace-settings.md
  - packages/dms-saas/docs/4.usage/1.public-screens.md
---

# Gating

What the plan caps: the `dms-saas.plan-intersection` permissions resolver (members keep the intersection, the owner gets the plan, parents are inherited, `*` is never granted to an owner) and the plan's member cap on invitations.

## Sub-features

- `the-plan-caps-members-and-gives-the-owner-all-of-it`: a member keeps only what both the role and the plan grant, the owner gets every permission of the plan, a parent plan's permissions are inherited, and * never reaches the owner.
- `the-plan-member-cap-bounds-invitations`: an invitation that would pass the plan's member cap is refused with 409, and a pending invitation takes a seat.

## How to get to it (user POV)

- Settings › Workspace › Members › Invite members; the effective permissions of a user through the fixture (`GetEffectiveUserPermissions`).

## Driving it with dms-control

```bash
dms-control journey "$RUN" gating
```

## Gotchas

- The invitation refusal answers 409 with the body `saas.errors.plan.seat_limit_reached`.
- A plan's permission list gets its ancestors added on write, so expectations are read from the stored plan.

## Coverage

| Documented behaviour | Journey check or reason |
| --- | --- |
| 5.extending.md "Tenant owner permissions" | plan-caps journey: owner, member, parent inheritance, plan edit, `*`; Not driven: role preview (needs the dashboard role editor) and the dms-saas.owner-only-surfaces resolver (order 110) |
| 2.workspace-settings.md "Members and seats" | member-cap journey: pending invitation takes a seat, the cap refuses; Not driven: the Seats block rendering, expired invitations and platform support members taking no seat, being over the cap keeps access |
