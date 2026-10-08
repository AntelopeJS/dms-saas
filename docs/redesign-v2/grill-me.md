# dms-saas v2 redesign: self-answered grill-me

This is the design interview held before the v2 redesign of `@antelopejs/dms-saas`.
Each question was asked and answered in turn; every answer is the recommendation that was
taken. It records **why** the pull request looks the way it does, so a reviewer can check
the code against the decisions instead of reverse-engineering them.

Inputs:

- the design mockup (`modules/saas/*`, `settings/billing.html`, `settings/workspace.html`,
  `settings/members.html`, `settings/data-export.html`) and its UX review (findings S01 to S20);
- `@antelopejs/dms` 0.6.0 / `@antelopejs/interface-dms` 0.4.0 (PR AntelopeJS/dms#119 and its
  follow-ups #160 to #167), the migration guide `docs/02.building/13.migration-0-3-to-0-4.md`;
- `@antelopejs/dms-frontend` 0.4.0 and 0.5.0 (module-declared auto-imports, `componentPrefix`).

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
`@antelopejs/interface-dms >=0.4.0 <1.0.0` (the repository's `antelopejs-check-interface-ranges`
requires `<1.0.0` for an interface it does not own), `@antelopejs/interface-data-api >=0.2.0`,
`@antelopejs/dms >=0.6.0 <0.7.0`, `@antelopejs/dms-frontend 0.5.0`, `@antelopejs/core 1.13.5`,
`@antelopejs/mongodb 1.4.2`, and the frontend layer's `engines` `>=0.5.0 <0.6.0`.

**Q6. `interface-dms-saas` changes in a breaking way. Does the module require 0.4 of it now?**
No. The repository releases the interface first and raises the module's range in a follow-up
(as #79 then #80 did). This pull request keeps `@antelopejs/interface-dms-saas >=0.3.0 <0.4.0`
in the module, so the workspace links the local package, and its commits are marked breaking
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

**Q10. The other breaking changes of interface-dms 0.4?**
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
i18n keys. The roles editor renders them through `processI18n`, so a workspace owner reads
"Billing · Payment method — See and replace the card that pays invoices" rather than a component
key. Components mounted only on platform-admin pages get the same treatment for consistency.

**Q14. Where do translations live?**
Split by area: `saas-en-GB.json` / `saas-fr-FR.json` keep what is shared (errors, notifications,
automation, statuses, permissions), and each area adds `saas-<area>-<locale>.json`
(dms-frontend merges every `*-xx-XX.json` of the layer). The parity test reads every file of a
locale. English and French are both complete.

## 4. One vocabulary (S07, S20)

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

## 5. Money (S01, S03, S04)

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

## 7. Workspace-owner surfaces

**Q42. Billing page?**
Top to bottom: the payment-failed alert when an invoice is unpaid (amount, decline date,
Stripe's next retry, suspension date, Update card / Pay invoice); the current plan with the seat
arithmetic (price × seats = total) and a meter of seats in use; the next invoice from Stripe's
preview; the payment method; a money-back guarantee card that is always visible to owners (days
left, amount, or when and why it ended); billing information; invoices and credit notes in one
table (All / Invoices / Credit notes). The extension anchors of `tenantBillingPage` stay.

**Q43. Changing plan (S02, S03)?**
Compare → Review → Confirm. The comparison shows the plans that fit the seats in use and
explains the ones hidden. Review shows what changes (seats, features gained and lost), when
(today for an upgrade, at renewal for a downgrade) and what is paid (prorated total with VAT
from Stripe's preview; a trial reads "€0.00 today · first charge on …"). The button names the
consequence: "Upgrade and pay €212.40", "Schedule downgrade". A scheduled downgrade shows on
the plan card with "Cancel downgrade".

**Q44. One past-due message (S12)?**
One layout banner on every page while an invoice is unpaid, one verb: "Pay invoice". On the
Billing page it gives way to the detailed alert. Members are told who the workspace owner is.

**Q45. General?**
Workspace name (save bar), "At a glance" (members and seats, plan, workspace owner, each linking
to where it is managed), and a danger zone: export first, then delete with the impact listed and
the name typed.

**Q46. Data export?**
What is included, the export in progress with its progress, the history with availability dates,
and the empty, failed and expired states.

**Q47. Seats on Members?**
A `Meter` of seats (members + pending invitations), platform support listed as using no seat,
and when full a banner telling the owner how to free or buy seats, and members whom to ask.

**Q48. Workspace switcher and creation (S19)?**
The switcher shows the plan, names a failed payment, searches name and owner, and keeps the
popover open while switching. Creating a workspace asks for a card only when the chosen plan
needs one (or the free-per-card policy does), and says why next to the field.

## 8. Public screens

**Q49. Pricing page (S18)?**
A new public page (`/pricing`, `EmptyLayout`): the public plans as cards, an interval toggle
only when both intervals exist, a full comparison from the features (main rows, then "See full
detail"), reassurance strip and FAQ from the billing rules. Each plan links to Register with the
plan.

**Q50. Register and No workspace?**
Show the plan the visitor signs up for. Registration still opens the workspace on the free plan
(the existing rule); a paid plan chosen on Pricing opens the upgrade review on Billing right
after. The card is asked according to `registration.paymentMethod`, with the reason.

**Q51. Workspace access restricted (S14)?**
Says why (suspended, pending payment, cancelled), the invoice timeline, how long data is kept;
the workspace owner gets Pay invoice / Billing / Stripe; a member is told which owner to contact;
everyone gets the list of their other workspaces, "Check again" and "Sign out".

**Q52. Legal pages?**
Title, version, last updated, contents built from the headings, related documents, and a back
link to where the visitor came from. An unpublished document reads "Content unavailable".

## 9. Verification

**Q53. How is it tested?**
Unit tests (vitest) for every new or changed route and computation (normalised MRR, credit
ceiling, attention queues, directory fields, plan change preview, segment preview, legal
versions…). `ajs dms verify-source` for the frontend layer. Then the playground, seeded with a
realistic catalogue and workspaces in every status, driven page by page with Playwright in both
themes, every overlay opened, the console watched: each error is a bug to fix. Flows that call
Stripe are covered by unit tests with Stripe mocked; in the browser their failure states are
checked, since the playground has no Stripe account.

**Q54. How is the work split?**
Shared vocabulary, money helpers, i18n split and the playground seed first; then one track per
area (dashboard & workspaces; users & segments; plans, migrations & features; invoices, credit
notes & billing rules; workspace-owner surfaces; public screens); then a pass of the whole
module in the browser.

## 10. Deliberately left for later

- **Asking customers to accept a new legal version.** Needs acceptance tracking at sign-in,
  which the DMS's auth flow owns. Versions and dates are stored, so it can be added on top.
- **Per-user saved table views** ("Save current view"): the DMS has predefined views only.
- **Download all invoices as a ZIP** on Billing: Stripe hosts the PDFs; each one stays
  downloadable.
- **Trial conversion rate** on the dashboard: the module keeps no trial history to compute it
  honestly.
- **A second price per plan** (monthly and yearly of the same plan): a plan has one interval;
  the toggle filters plans by interval.

## 11. Where the implementation departed from an answer

Recorded after the build and the browser pass, so the answers above stay as they were decided.

- **Q13, blocks fed by a route:** a `StatGroup`, `NavCardGrid` or `KeyValueList` block cannot put
  parameters into its texts on the client, and `fetchUrl` / `badgesUrl` do not read the page's
  route parameters in DMS 0.6. Routes therefore word their items server-side in the request's
  language (`src/i18n/server-messages.ts`). Detail pages first wrapped the blocks in a custom
  `DmsSaasRouteScopedBlock` filling `{id}` from the URL; since DMS 0.6.1 the stock blocks take
  `{{params.id}}` in their URLs and refetch on `refreshPageBlocks()`, so the wrapper is gone.
  Headline figures that need parameters are small custom components built on `DmsStatGroup`.
- **Q21, disabled row actions:** DMS row actions have no per-row disabled reason. "Issue credit
  note…" is greyed out by a rule, the reason is in the table's footer hint and in the dialog, and
  the server refuses anyway. Open invoices get a third mode, "Reduce the amount due", the only
  credit Stripe allows on them.
- **Q23, dashboard periods:** 30 days, 90 days and year to date (the DMS has no "12 months"
  preset). Churn approximates the MRR at the start of the period as today's MRR plus the MRR lost.
- **Q27, owner pays:** the server requires a paid plan synced with Stripe; the owner meets the
  first-payment checkout from the access-restricted screen and Billing.
- **Q34, retiring a plan:** the plan is closed to sign-ups and its workspaces migrated; it is not
  deleted automatically (an existing rule keeps it), "Delete plan" appears once it is empty. The
  owner notice is the in-app notification, sent to workspace owners.
- **Q35, price change:** the `Form` block cannot intercept a submit, so the consequence is stated
  in the live preview before saving and in a notice after.
- **Q37, migration tabs:** a stored `stage` (running, needs attention, done) backs the tabs, since
  a select column cannot be filtered on several values.
- **Q40, timeline:** no "final reminder" step and no fixed retry days: the module sends no final
  reminder and cannot read Stripe's retry schedule.
- **Q43, upgrades:** an owner's upgrade charges the prorated difference at once
  (`always_invoice`), which is what makes "Upgrade and pay €212.40" true; a declined card changes
  nothing. Up- and downgrades compare what each plan costs for the seats in use.
- **Q45, General:** the DMS tenant has neither a logo nor a URL slug; the page shows the workspace
  id instead. Deleting a workspace goes through `POST /api/saas/workspaces/current/delete` with the
  typed name, which replaces `DELETE /current`.
- **Q46, Data export:** the DMS export API has no cancel and no archive size, and keeps an archive
  24 hours; the page shows the real expiry date.
- **Q51, suspended screen:** data is deleted only for cancelled workspaces, so a suspended one reads
  "nothing has been deleted"; the invoice timeline has no attempt count (the mirror does not store
  one).
- **Form rows that need the full width** (the plan feature matrix, the segment rules): a DMS form
  row gives its control a 240px column when the field has no label; `frontend-vue/app/assets/css/saas.css`
  lets such an editor span the row. Worth fixing in the DMS's `FieldRow`.
