---
title: "v2 redesign decisions, part 1"
description: The design interview held before the v2 redesign of the DMS SaaS module, from its scope to the operator screens.
mode: explanation
---

This page records the decisions as they were taken before the v2 redesign of `@antelopejs/dms-saas`. The module docs describe the current behaviour.

This is the design interview held before that redesign.
Each question was asked and answered in turn; every answer is the recommendation that was
taken. It records **why** the pull request looks the way it does, so a reviewer can check
the code against the decisions instead of reverse-engineering them. Sections 1 to 6 are on this page. Sections 7 to 11 continue in [the second part](./redesign-v2-grill-me-2.md).

Inputs:

- the design mockup (`modules/saas/*`, `settings/billing.html`, `settings/workspace.html`,
  `settings/members.html`, `settings/data-export.html`) and its UX review (findings S01 to S20);
- `dms` 0.6.0 / `interface-dms` 0.4.0 (PR `AntelopeJS/dms#119` and its
  follow-ups #160 to #167), the migration guide `docs/02.building/13.migration-0-3-to-0-4.md`;
- `dms-frontend` 0.4.0 and 0.5.0 (module-declared auto-imports, `componentPrefix`);
  the module now requires `dms` 0.7.7 and `dms-frontend` 0.5.2 (see Q5).

---

## 1. Scope and shape of the change

**Q1. One pull request, or one per area?**
One pull request, as asked, made of one commit per area so it can be reviewed commit by
commit: dependencies and breaking changes first, then the shared vocabulary, then each area.

**Q2. Does "apply the new design" mean every screen of the mockup?**
Yes: the 14 operator screens, the 5 workspace-owner surfaces (Billing, General, Data export,
the seat block on Members, the in-app surfaces) and the 8 public screens, with their overlays
and their loading / empty / error states. Where the design implies a feature the module does
not have yet (pricing page, review step before a plan change, guarded credit notes, workspace
creation where the owner pays…), the feature is built. Section 10 lists the few things that
were deliberately left for later, each with its reason.

**Q3. The mockup's sidebar has "Customer-facing" and "Design review" entries. Are they pages?**
No. `surfaces.html`, `public.html` and `review.html` are specimen sheets of the mockup: they
show where each customer-facing piece appears. The product gets the pieces themselves, not the
specimen pages.

**Q4. Is the information architecture of the review kept?**
Yes: Overview › Dashboard; Customers › Workspaces, Users, Segments; Catalogue › Plans,
Features, **Plan migrations** (promoted to the menu, it holds failures to reconcile); Billing ›
Invoices, Credit notes; Configuration › **Billing rules & legal** (one page, one save). The
workspace-owner pages stay in the core settings navigation, under the DMS's workspace category.

## 2. Dependencies and breaking changes

**Q5. Which ranges?**
`interface-dms` from 0.4.0, below the next major (the repository's `antelopejs-check-interface-ranges`
requires a cap at the next major for an interface it does not own), `interface-data-api` from 0.2.0,
`dms` from 0.7.7 in the 0.7 line, `dms-frontend` from 0.5.2 in the 0.5 line, `core` 1.13.5,
`mongodb` 1.4.2, and the frontend layer's `engines` set to the `dms-frontend` 0.5 line from 0.5.2.

**Q6. `interface-dms-saas` changes in a breaking way. Does the module require 0.4 of it now?**
No. The repository releases the interface first and raises the module's range in a follow-up
(as #79 then #80 did). This pull request keeps the module on the `interface-dms-saas` 0.3 line
(`>=0.3.0`, below 0.4.0), so the workspace links the local package, and its commits are marked breaking
so the next interface release is 0.4.0.

**Q7. What happens to the module's own `settings.workspace` category?**
It goes. DMS 0.4 owns `workspaceSettingsCategory` (`settings.workspace`, members, invitations
and roles live there); registering a second category with the same id collides. The tenant
pages sit under the DMS's category, without `module` (a module's page under the settings root
throws). `interface-dms-saas` drops its `workspaceSettingsCategory` descriptor and
`WORKSPACE_SETTINGS_CATEGORY_DEFINITION`; `GetWorkspaceSettingsCategory` stays and resolves the
DMS's category. The seat block now extends `settings.workspace.members`.

**Q8. How are component names kept stable with `componentPrefix`?**
The frontend module declares `componentPrefix: "DmsSaas"` and registers names without it, so
every backend `CustomComponent("DmsSaasXxx")` keeps resolving. The one name that changes is the
`auth/no-workspace` custom page, registered as a component `DmsSaasAuthNoWorkspace` (it was
`DmsAuthNoWorkspace`, which sat in the DMS's own prefix).

**Q9. Auto-imports?**
`dms.frontend.build.ts` declares `app/composables`, `app/utils` and `app/types`. Code private to
the module goes under `app/build/` and is imported by path.

**Q10. The other breaking changes of `interface-dms` 0.4?**
Applied as the migration guide says: confirmations move from the target to the action
(`confirmColor` → `color`), `formContainer.pages.view` → `details`, a tab takes one `filter`,
forms declare `saveMode` / `kind`, tones are `Tone`, `StatStrip` is `StatGroup`, `DmsPermissionsTree`
and `PermissionsTreeNode` are gone (the plan editor gets its own permission picker, see Q41),
edit routes accept a partial body, the OAuth callback takes an `origin`.

## 3. Building blocks

**Q11. Blocks or custom components?**
DMS blocks first, always. A page is a backend tree of `KpiCard`, `StatGroup`, `ChartCard`,
`TopListCard`, `ActivityFeed`, `KeyValueList`, `Card`, `NavCardGrid`, `Banner`, `EmptyState`,
`Meter`, `Section`, `FieldRow`, `Form` (sections, `sectionNav`, `saveMode`), `TableView`
(tabs with counts, views, cards display, drawers, row rules, confirmation dialogs with
fields, `reorder`, `fromSource`) and `Tab` / `Grid` / stacks. A custom component is written
only where no block expresses the screen: money-moving dialogs, plan cards, the plan feature
matrix and permission picker, the segment rule builder and its live preview, Stripe's payment
element, the workspace switcher, the plan change flow. Custom components are built from the
public DMS components (`DmsCard`, `DmsSection`, `DmsFieldRow`, `DmsStatusPill`, `DmsMeter`,
`DmsKeyValueList`, `DmsEmptyState`, `DmsBanner`, `DmsConfirmModal`, `DmsIconWell`…), never from
the DMS's private `build/` components.

**Q12. Every page described on the backend?**
Yes. Every page, including the public ones and the tenant settings pages, is a
`PageController` whose static fields are its blocks. No page is a client-only route.

**Q13. What does `.meta()` carry?**
Every custom component and every block that does not take its name from a `title` gets
`.meta({ name, description, icon })`, with `name` and `description` as `$saas.permissions.*`
i18n keys. The roles editor renders them through `processI18n`, so a workspace owner reads the
name "Billing · Payment method" and the description "See and replace the card that pays invoices"
rather than a component key. Components mounted only on platform-admin pages get the same treatment for consistency.

**Q14. Where do translations live?**
Split by area: `saas-en-GB.json` / `saas-fr-FR.json` keep what is shared (errors, notifications,
automation, statuses, permissions), and each area adds `saas-<area>-<locale>.json`
(`dms-frontend` merges every `*-xx-XX.json` of the layer). The parity test reads every file of a
locale. English and French are both complete.

## 4. One vocabulary

This section answers findings S07 and S20 of the UX review.

**Q15. One colour per status: where is it defined?**
In one table per status family, shared by the backend (column displays, pill tones) and the
frontend (`useSaasStatus`):

| Workspace | Tone | Invoice | Tone | Credit note | Tone | Migration | Tone |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Active | success | Draft | neutral | Issued | success | Running | info |
| Trialing | info | Open | warning | Void | neutral | Completed | success |
| Free | primary | Paid | success | | | Partially failed | warning |
| Past due | error | Void | neutral | | | Reconciliation required | error |
| Pending payment | warning | Uncollectible | error | | | Pending | neutral |
| Suspended | error | | | | | | |
| Cancelled | neutral | | | | | | |

Credit note types read "Credit to balance", "Refund to card", "Before payment", "After
payment", "Mixed".

**Q16. "Owner" means three things. Which words?**
"Platform admin" (the DMS owner, `*`), "Workspace owner" (`isTenantOwner`), "Operator actions"
(what a platform admin does to a workspace). Only labels change: permission ids, routes and
code identifiers stay.

**Q17. Ids on screen?**
Plan names instead of plan ids, Stripe ids as mono links to the Stripe dashboard, invoice
numbers instead of database ids.

**Q18. What does every block do while loading, failing and empty?**
Skeleton of its own shape, inline error with Retry saying what still works, an empty state
that offers the next action. The DMS blocks do this already; custom components follow
(`try/finally` without `catch` is gone).

## 5. Money

This section answers findings S01, S03 and S04 of the UX review.

**Q19. In what unit do operators type money?**
Major units, with the currency as an addon (`€ [49.00] EUR`). The API keeps minor units, as
Stripe does; the conversion lives in one helper that reads the currency's exponent from
`Intl.NumberFormat`.

**Q20. What does a money dialog show before it acts?**
The ceiling and how it is computed, a "Use max" shortcut, and a live sentence of the outcome
("Northwind Traders receives €49.00 as balance credit"). The server enforces the same ceiling.

**Q21. Which invoices can be credited?**
Paid and open invoices only. Elsewhere the row action is shown disabled with its reason (void:
never charged; draft: still editable). The ceiling is `total − sum of issued credit notes`, and
the modal lists the invoice lines and the prior credits.

**Q22. Refund to card?**
A second, explicit confirmation naming the amount, the card and that it cannot be undone.

## 6. Operator screens

**Q23. Dashboard: which numbers are honest?**
MRR is normalised: yearly ÷ 12, per-seat × billed seats, trials, complimentary and free
excluded, labelled "Normalised". It is computed in a reporting currency (EUR by default) and
says when other currencies exist. KPIs: MRR, paying workspaces (of all), trials (ending in 14
days), churn over the period (cancellations and MRR lost). Trial conversion needs a history the
module does not keep, so it is not invented.

**Q24. Dashboard: "Needs attention"?**
First block of the page: a `NavCardGrid` fed by the server with one card per queue (past due
with the amount at risk and the first suspension date; complimentary access ending within 7
days; migrations needing reconciliation; open invoices), each linking to the matching
workspace view or list. An empty queue shows nothing; an empty grid says all is clear.

**Q25. Dashboard: the rest?**
`PeriodSelector` (30 days, 90 days, 12 months) driving the KPIs and the chart; paid invoices
over 12 months (collected vs credited); workspaces by status (one colour per status, linking to
the list); plans by MRR (`TopListCard`); recent activity (`ActivityFeed`, with All / Billing /
Lifecycle as tabs); "Create workspace" as a header action.

**Q26. Workspace list: what must it answer?**
A tab per status with server-counted badges; columns Workspace (name + id), Status, Plan (price
× seats), MRR, Owner (joined / invitation pending / expired / no owner), Renews or ends (renewal,
trial end, free until, suspension date, deletion date), Created; predefined views "Complimentary
access ending this week", "Past due for more than 7 days", "Trials ending in 14 days", "Owner
never joined", "MRR over 500"; a `StatGroup` above (MRR, past due, complimentary ending, trials
ending). Filtering and sorting on these columns requires stored values, so the workspace
directory row carries denormalised `mrr`, `renewsAt`, `ownerStatus`, plan label and seats,
refreshed wherever the billing state is recomputed. "Save current view" needs per-user saved
views the DMS does not offer: predefined views only.

**Q27. Creating a workspace: what does the operator choose?**
The access model, explicitly (S05): "Complimentary until…" (complimentary subscription, as
today) or "Owner pays on first sign-in" (subscription in `pending_payment` on the chosen plan:
the owner meets the existing checkout path). The dialog looks the owner e-mail up (existing user
added, or new user invited for 7 days) and ends with a "What happens" sentence. A failed
invitation e-mail is a sticky warning with "Copy invitation link".

**Q28. Workspace detail: header?**
Tile, name, status, plan, workspace owner, created date, then one primary action (Change plan,
or Grant free access when nothing is billed) and an overflow menu with the danger actions
separated. Under it a `StatGroup` of facts: MRR, seats (+ pending invitations), next invoice
(from Stripe's preview), Stripe customer (mono link), lifetime revenue. "Join as member" asks
first and becomes "Joined" once done.

**Q29. Workspace detail: body?**
Tabs Overview / Invoices / Credit notes / Members / Activity with counts. Overview: billing
information (`KeyValueList`), subscription timeline, latest invoices, recent activity. The
tables lose the constant Workspace column and gain their row actions (PDF, Stripe, credit
note). Sidebar: operator actions, available Stripe credit, internal notes, and a danger zone
`Section` with Suspend.

**Q30. Suspend, reactivate, complimentary access (S06)?**
Suspend lists its impact (members losing access, subscription paused, next invoice not charged,
owner e-mailed) and requires typing the workspace name. Reactivate is a lighter confirmation.
Complimentary access over a paid Stripe subscription states that the subscription is cancelled
and the MRR it stops, and requires ticking "I understand". The "Update free access" label is
derived from the subscription being complimentary, not from the plan being free.

**Q31. Immediate upgrade?**
Shows Stripe's prorated preview (lines, unused time, subtotal, VAT, due today, then the next
renewal) and names the amount on the button.

**Q32. Users?**
Tabs All / Platform admins / Unverified; columns platform role, workspaces (owned · member),
segments, last active, created. Promote and demote are confirmations listing what the role grants
or removes; demoting yourself is disabled with the reason. User detail: identity header, facts
(`StatGroup`), tabs Workspaces / Billing / Segments ("why she matches"), sidebar Security &
sign-in, notes, platform role.

**Q33. Segments (S08)?**
The list states rules in words and when they were last evaluated; row actions Edit, Export
users (CSV), Re-evaluate now, Duplicate, Delete. The editor reads like sentences (human field
names, enum labels as pills) and has a live preview: match count, change versus the saved
version, sample users, recounted on each edit (debounced) by a preview route that evaluates the
draft conditions without saving.

**Q34. Plans (S17)?**
Cards (default) and table displays; `StatGroup` (plans on sale, workspaces, catalogue MRR,
legacy plans); tabs On sale / Legacy / All; drag to reorder, saved instantly. Each card shows
price per interval and mode, trial, audience, member cap, workspaces and MRR share, and the main
features. Turning a plan off confirms ("Stop selling Team?"), with the impact; a failed save is
reported. "Retire plan…" is a three-step dialog: impact, target plan with the feature
differences in plain words and the owner e-mail, typed confirmation; it runs the existing
snapshot migration. "Delete plan" exists only when no workspace uses the plan.

**Q35. Plan editor (S15, S16)?**
A `Form` with `sections` and `sectionNav`: Identity, Pricing, Access & features, Limits,
Visibility, saved through the save bar. Next to it, a sticky live preview of the card as
customers see it and the Stripe sync status. Prices are typed in major units with a VAT
example; a price change explains on save that a new Stripe price is created and existing
subscribers keep theirs until migrated.

**Q36. Feature values: what does −1 mean?**
One meaning everywhere: per feature, a tri-state control Off (0 / false) · Limit [n ≥ 1] ·
Unlimited (−1), and the customer comparison renders the same three. Each row says whether it is
inherited from the parent plan or overridden, with a reset. Text features are editable.

**Q37. Plan migrations?**
In the menu, with tabs All / Running / Needs attention / Completed, progress, who started it.
The detail lists the workspaces needing attention with what Stripe and the DMS each say, and
offers "Stripe shows X: mark as moved" / "allow retry" per uncertain workspace, "Retry failed",
and "Mark as reconciled" with an audit note once nothing is uncertain.

**Q38. Features?**
A table with value type, unit, number of plans using it, main row vs "behind See full detail",
order by drag; edited in a drawer whose value type is locked while plans store a value; delete
is refused with the reason while plans use it.

**Q39. Invoices and credit notes?**
`StatGroup` (awaiting payment, collected this month, credited this month, written off this
year), tabs per status with counts, amounts in each invoice's own currency, the workspace with
its plan, the status with its sub-state ("Payment failed · retry Oct 2"), credited amount, CSV
export. Credit notes: type in words, reason, issued by (operator, or "Automatic"), the invoice
it corrects. A credit note is issued from its invoice.

**Q40. Billing rules & legal?**
One `Form`, one save, sections with a side navigation: Unpaid invoices (with the customer's
timeline computed from the values), Free workspaces (per card), Tax (Stripe tax category,
"Re-sync plans"), Refund policy (with a worked example), Legal documents. Each legal document
gets a version and a publication date, bumped when its text changes.

**Q41. The permission picker that replaced `DmsPermissionsTree`?**
A dialog of the plan editor: permissions grouped by page, with search, expand all, counts per
group, and the rows coming from the parent plan tagged. It keeps the existing rule that ticking a
node adds its descendants and ancestors.
