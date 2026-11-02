---
title: "v2 redesign decisions, part 2"
description: The design interview held before the v2 redesign of the DMS SaaS module, from the workspace-owner surfaces to where the build departed from it.
mode: explanation
---

This page continues [the first part](./redesign-v2-grill-me.md) of the design interview held before the v2 redesign of `@antelopejs/dms-saas`. It records the decisions as they were taken, and the module docs describe the current behaviour. The questions in sections 1 to 6, Q1 to Q41, are on the first page.

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
  Since DMS 0.7.2 every block these routes feed (`ActivityFeed`, `NavCardGrid`, `TopListCard`
  included) takes composed texts, so the routes answer raw values and the server-side wording is
  gone.
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
  a select column cannot be filtered on several values. A "Partially failed" migration is done:
  it sits under Completed, as the answer files it, and not under Needs attention as the design
  mockup does (kept after the 2026-10 audit). Nothing is left in flight on it, and its failed
  workspaces are still listed, with "Retry failed", on its detail page.
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
  "nothing has been deleted"; its invoice timeline shows no attempt count (the mirror stores
  `Invoice.attemptCount`, which the invoice lists read, but the timeline does not).
- **Form rows that need the full width** (the plan feature matrix, the segment rules): these
  fields have no label, and the DMS's `FieldRow` spans a label-less control over both form columns
  (`AntelopeJS/dms#205`), so no workaround is left in `dms-saas`.
