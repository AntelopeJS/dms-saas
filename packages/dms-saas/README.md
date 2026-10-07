# @antelopejs/dms-saas

<div align="center">
<a href="./LICENSE"><img alt="License" src="https://img.shields.io/badge/license-Apache--2.0-blue?style=for-the-badge&labelColor=000000"></a>
<a href="https://discord.gg/sjK28QHrA7"><img src="https://img.shields.io/badge/Discord-18181B?logo=discord&style=for-the-badge&color=000000" alt="Discord"></a>
<a href="https://antelopejs.com"><img src="https://img.shields.io/badge/Docs-18181B?style=for-the-badge&color=000000" alt="Documentation"></a>
</div>

SaaS extension module for the AntelopeJS DMS.

Adds multi-tenant billing, plans, workspace switching, self-service workspace creation, refund policies, segments, reminders, and Stripe integration on top of the core DMS multi-tenant primitives.

See the design documents in `dms/saas/` (sibling repo) for the full architectural reference.

## Vue frontend development

The module registers `frontend-vue/dms.frontend.ts` with the Vue 3 Inertia
adapter. It preserves the `DmsSaas*` component names, the `auth/no-workspace`
page override, client-only displays, global guards, and English/French catalogs.
Public module configuration is exposed under `public.dmsSaas`. Stripe secrets
are never exposed to the frontend.

The backend integration requires `@antelopejs/dms`. Frontend source
verification runs through `@antelopejs/dms-frontend` and the DMS frontend
source shipped in that published DMS package; no sibling checkout or local
package link is required.

This package lives in `packages/dms-saas` of the `AntelopeJS/dms-saas`
workspace. From that directory run `pnpm install`,
`pnpm --dir frontend-vue install`, `pnpm build`, `pnpm typecheck`, and
`pnpm test:frontend`. The frontend check generates a temporary workspace, then
builds client, SSR, and email bundles and runs Vue typechecking. To run the
playground frontend during backend development, use `pnpm frontend:dev`; this
dispatches through the core CLI as `ajs dms dev`. The playground connects to
MongoDB at `mongodb://localhost:27017` unless `MONGO_URL` is set, either in the
environment or in `playground/.env`.

## Completing a registration that entered without a workspace

An account can reach the product before it owns anything to log into: an OAuth
sign-in for an unknown e-mail, or any entry point the core answers with
`requires_tenant_assignment`. The `auth/no-workspace` page is where that
account opens its first workspace — on the free plan, with a card when
`registration.paymentMethod` asks for one — and
`POST /api/saas/register/finalize` provisions it and answers with a token pair
for the workspace it just created, so the visitor lands signed in instead of
back on the login screen.

The page never touches those tokens. It posts the call through the frontend
loader's generic `POST /auth/establish` route, naming the endpoint to call and
its payload; the loader calls `/api/saas/register/finalize` itself over its own
server-to-server channel to the DMS API and writes its session cookie from what
comes back. Because that route turns a backend endpoint into a login, it only
calls endpoints the deployment named, so a project serving this page must
declare the finalize endpoint in the frontend server's environment:

```bash
# .env of the frontend server
DMS_AUTH_ESTABLISH_ENDPOINTS=/api/saas/register/finalize
```

Without it the loader answers `403` and a visitor who has just registered stays
signed out. A replacement completion screen keeps the same requirement, and can build
its request with the auto-imported `buildSessionEstablishRequest()` helper
rather than restating the endpoint and the payload shape.

## Tenant owner permissions

The `dms-saas.plan-intersection` permissions resolver runs at order 100. For a
member whose `isTenantOwner` is true in the requested tenant, it grants all
explicit permissions from that tenant's resolved plan, including inherited
permissions, regardless of assigned roles. Permissions outside the plan are
removed even when a role grants them. Other members retain only the intersection
of their incoming permissions and the resolved plan.

A plan grants exactly the ids it lists, nothing nested under them: the plan
editor's permission tree adds a node's descendants and ancestors when it is
ticked, so plans built from the UI list every component id, and plans seeded by
code must list them too.

Tenant ownership never grants `*`, even if a plan contains it. An incoming `*`
(including the DMS platform owner's wildcard) retains the existing behavior:
the wildcard survives, and other incoming permissions are intersected with the
plan. Without a subscription, a `planId`, or an existing plan, the resolver
preserves incoming permissions and grants nothing new. This compatibility
fallback is not a denial of access for tenants with missing billing data.

Applications define their business permissions and can project the capabilities
that survive the plan into resource-specific actions in later resolvers. They
do not need a separate tenant-owner grant list. Subscription access gates remain
independent and unchanged. This resolver alone does not constrain
`defaultGranted` permissions or guards that do not consult effective permissions.

## Registration

Public registration is short: an account (name, e-mail, password) and the
acceptance of the terms, plus a card when the deployment asks for one. The
workspace it opens lands on the catalogue's first free plan — the lowest
`order` among active plans priced 0 and open to individuals — under a default
name its owner renames from the workspace settings. Customer type, billing
address, VAT number and plan choice belong to the upgrade flow. Registration
answers `409 saas.errors.plan.no_free_plan` while the catalogue has no such
plan.

`POST /api/saas/register` holds the password to the DMS password policy
(`isPasswordCompliant` from `@antelopejs/interface-dms/auth/password`) before
it looks the e-mail up or creates anything, and answers
`400 saas.errors.registration.password_policy` otherwise. The OAuth completion
carries no password.

Two module options shape it:

```json
{
  "modules": {
    "dms-saas": {
      "config": {
        "admissionMode": "open",
        "registration": { "paymentMethod": "required" }
      }
    }
  }
}
```

`registration.paymentMethod` decides whether registration asks for a card:

| Value | Behaviour |
| --- | --- |
| `required` (default) | The card step is shown and must be completed. The workspace gets a Stripe customer and a free subscription on that card, and the free-workspace-per-card cap applies. |
| `optional` | The card step is shown, and the visitor may choose to add a card later. Without a card the workspace is card-less, as under `none`. |
| `none` | The card step is never shown, `GET /api/saas/register/setup-intent` answers `400 saas.errors.registration.payment_method_disabled`, and Stripe is never called: the workspace gets a local free subscription with no Stripe customer, which the upgrade checkout creates when the owner first pays. A card sent anyway is ignored. |

Under `optional` and `none`, a card-less workspace has no card fingerprint, so
the free-workspace-per-card cap does not apply to it: the only remaining limit
on free workspaces is one account per e-mail address.

The option covers both public entry points — `POST /api/saas/register` and the
`auth/no-workspace` completion — and nothing else: invitation sign-up never
asks for a plan or a card, whatever `admissionMode` and
`registration.paymentMethod` say. Tenant-side workspace creation keeps
requiring a card.

`admissionMode: "invitation-only"` closes public registration: every
`/api/saas/register` route answers `403 saas.errors.registration_closed` before
looking at the card policy, the registration screens render a "registration by
invitation only" state instead of the form, and the login page drops its
sign-up link. Invitations keep working.

Both values reach the browser through the frontend module options
(`useDmsRuntimeConfig().public.dmsSaas.admissionMode` and
`.registrationPaymentMethod`); `useSaasRegistration()` already reads them.

The Stripe SetupIntent behind the card step is restricted to cards on the
server (`allowed_payment_method_types: ["card"]`, since Stripe is retiring
`payment_method_types` on SetupIntent creation); the Payment Element is
created from its client secret alone, since Stripe refuses
`paymentMethodTypes` next to a `clientSecret`.

## Default plan

A workspace is never without a plan. The default plan is the catalogue's
first free plan — the lowest `order` among active plans priced 0 and open to
individuals — unless `defaultPlanSlug` names another such plan:

```json
{ "modules": { "dms-saas": { "config": { "defaultPlanSlug": "free" } } } }
```

It is what registration opens, and it is attached, as an active card-less
subscription, to every workspace that has no subscription at all — the
platform's `default` tenant and workspaces created outside dms-saas included.
The backfill runs at startup and with the billing-state recompute every 15
minutes, and the billing page covers a workspace on first read; each pass is
idempotent and never touches a workspace that holds any subscription. While
the catalogue has no free plan, nothing is attached and a warning is logged.

Once attached, the plan's permissions cap the workspace's members like any
other plan (see [Tenant owner permissions](#tenant-owner-permissions)).

## Stripe API version and webhooks

Every Stripe request is made with API version `2026-08-26.dahlia`, the version
the installed `stripe` SDK (v22) is generated for (`STRIPE_API_VERSION` in
`src/stripe/client.ts`; the build fails if the two drift apart).

A webhook endpoint renders its events in its **own** API version, set in the
Stripe Dashboard (Developers → Webhooks → the endpoint → API version), not in
the version of the requests. **Every endpoint that targets
`/api/saas/webhooks/stripe` must use `2026-08-26.dahlia`.** Until it does,
dms-saas still accepts events rendered in older versions: the fields basil
moved — the subscription billing period (now on each subscription item), the
invoice's subscription (`parent.subscription_details`), invoice and credit
note taxes (`total_taxes`), and the credit note refund (`refunds`) — are read
from their basil location first and from their older one second. The clover
and dahlia releases moved none of the fields dms-saas reads.

New subscriptions, whether created at registration or by Checkout, are opened
in the `classic` billing mode (`billing_mode[type]=classic`). Since
`2025-09-30.clover` Stripe defaults new subscriptions to `flexible`, which no
longer invoices a free-to-paid upgrade at once and records Customer Portal
cancellations as `cancel_at` instead of `cancel_at_period_end`; the plan-change
flows rely on the `classic` behaviour every existing subscription has.

Checkout Sessions opt out of Stripe Managed Payments
(`managed_payments[enabled]=false`). An account that enabled Managed Payments
applies it to every session by default, but dms-saas is its own merchant of
record: it collects tax ids, runs Stripe Tax on its invoices, injects invoice
items and issues credit notes, none of which a Managed Payments session allows.

## Starting a paid plan

Moving a workspace without a Stripe subscription to a paid plan opens a Stripe
Checkout Session. The request is recorded on the subscription as a pending
checkout before Stripe is called, and the session's completion or expiry
webhook resolves it. A pending checkout never blocks the owner for good:

- when Stripe refuses to open the session (a 4xx answer), the pending
  checkout, the trial it reserved and the Stripe customer it created are
  rolled back, and the request answers
  `422 saas.errors.billing.checkout_rejected`; the owner can retry at once;
- when Stripe cannot be reached or answers a 5xx, a session may exist, so the
  pending checkout stays and the request answers
  `503 saas.errors.billing.checkout_unavailable`;
- the next attempt reconciles what it finds: a pending checkout whose recorded
  session has expired, or which never recorded a session within 15 minutes, is
  released and a new session is opened. Its redirect URL only reaches the
  owner once the session is recorded, so an unrecorded session is one nobody
  can pay;
- a recorded session that is still open answers
  `409 saas.errors.plan.checkout_in_progress`, and any other pending plan
  change `409 saas.errors.plan.change_in_progress`.

## Plans and Stripe

dms-saas keeps every plan billed through Stripe linked to a Stripe product and
price that match it, whoever writes the plan: the platform-owner plan editor,
or a module that seeds its catalogue straight into the plan table. A writer
sets the plan's name, description, price, currency, interval and billing mode,
and leaves `paymentProviderRefs` alone — dms-saas owns it.

A plan is billed through Stripe when its price is above 0, or when it is
already linked to a Stripe price its subscriptions may be billed on. A plan
priced 0 that never was stays off Stripe: its workspaces hold a local free
subscription.

The sync runs:

- when the plan editor creates or saves a plan, after writing it (a Stripe
  error is reported to the editor, and the next pass retries the sync);
- once DMS has initialised the database at startup, in the background, for
  every active plan;
- whenever a plan is about to be offered or billed — the tenant plan catalogue,
  a plan change, an operator action, a new workspace — so a plan written after
  startup is linked the first time it matters.

Outside the editor, a failed sync is logged and retried on the next pass; the
plan meanwhile shows as not payable, and choosing it answers
`400 saas.errors.plan.not_synced_with_stripe` as before. With a placeholder
Stripe key, every sync is skipped.

Each sync compares the plan with the terms recorded in
`paymentProviderRefs.stripeSyncedTerms` and calls Stripe only when they differ:

| What changed | Stripe effect |
| --- | --- |
| Nothing | none |
| Name, description, or the billing settings' tax code | the product is updated in place |
| Price, currency, interval or billing mode | a new price is created and the previous one archived; existing subscriptions stay on their price |

Amounts are sent in the currency's minor unit (price × 100) and the currency
in lowercase. A plan linked before the terms were recorded is read back from
Stripe once: a price that still matches is kept, so its subscriptions still
resolve to the plan.

Every Stripe creation carries an idempotency key derived from the plan id, its
creation time and the request, so replicas syncing the same plan at once, or a
retry within Stripe's 24-hour window, land on the same product and price. Only
`paymentProviderRefs` is written back: a sync never rolls back a concurrent
edit, and one that raced an edit is out of line again and redone on the next
pass.

## Plan feature labels and values

A feature's `displayName` and `tooltip` are localized fields
(`@Localized`, falling back to `en`): the row stores one value per locale and
every reader gets the text in the viewer's language, taken from the
`x-content-language` header the DMS frontend sends. The tenant plan pages and
the plan admin pages show it as written; the features table in the platform
admin edits it one language at a time.

A module declaring features writes every locale at once through
`localize("*")`, never i18n keys:

```ts
const row = FeatureModel.fromPlainData({
  _id: "cloud.plan.egress",
  displayName: { en: "Included egress", fr: "Trafic sortant inclus" },
  tooltip: { en: "Outbound traffic", fr: "Trafic sortant" },
  // ...
}).localize("*");
await GetModel(FeatureModel).insert(row);
```

Read a row with `localizeFeature(feature, locale)` from
`@antelopejs/interface-dms-saas/plans`. A row without a value in the viewer's
locale or in `en` has no tooltip.

Values are formatted from the feature's `valueType` and `unit`: `-1` reads as
unlimited, booleans as ✓/—, numbers are grouped in the viewer's locale. A
`per <unit>` unit makes the value a price in the plan's currency, and
`currency units` an amount of it. Known units are scaled to something a person
reads at a glance; any other unit is shown verbatim after the grouped number.
A text value follows the same convention as labels: a `$<key>` value is
translated in the declaring module's locales, anything else is shown as stored.

| Stored unit | Quantity reads as | `per <unit>` price reads as |
|-------------|-------------------|-----------------------------|
| `byte(s)` | bytes, KB, MB, GB or TB (powers of 1000) | per GB |
| `minute(s)` | minutes | per minute |

A module declaring features in its own units teaches the plan pages how they
read with `registerPlanFeatureUnit`, auto-imported like the other dms-saas
composables. Call it from a frontend plugin that runs on the server and in the
browser, so server-rendered and hydrated values agree. Each scale says how
many stored units it holds; a quantity takes the largest scale it fills, and a
`per <unit>` price reads per `priceScale`. Labels are full i18n keys the module
ships in its own locales, each a node holding a `quantity` message
(`{value}`, pluralised on the scaled value) and a `price` message (`{price}`):

```ts
// frontend-vue/app/plugins/plan-feature-units.ts
const MINUTES_PER_HOUR = 60;
const vcpuHour = { label: "cloud.plan.units.vcpu_hour", size: MINUTES_PER_HOUR };

export default defineDmsPlugin(() => {
  registerPlanFeatureUnit(["vCPU-minute", "vCPU-minutes"], {
    scales: [vcpuHour],
    priceScale: vcpuHour,
  });
});
```

```json
{
  "cloud": {
    "plan": {
      "units": {
        "vcpu_hour": {
          "quantity": "{value} vCPU-hour | {value} vCPU-hours",
          "price": "{price} / vCPU-hour"
        }
      }
    }
  }
}
```

Units match case-insensitively, and a registered unit takes precedence over a
built-in one of the same name.

## Extension points

### Consuming this module

A module that extends dms-saas depends on the separately published interface
package (`"@antelopejs/interface-dms-saas"` in its `dependencies`) and
imports the extension points from it. The dms-saas runtime package remains a
separate dependency for modules that need the implementation; its package root
boots the registration graph:

| Subpath | Surface |
| --- | --- |
| `@antelopejs/interface-dms-saas` | every extension point except `db`: billing, data API, pages, plans, provisioning and registration flat, plus the `invoiceLineItems` and `workspaceLifecycle` namespaces |
| `@antelopejs/interface-dms-saas/billing` | customer balance, upcoming invoice preview and complimentary subscription state |
| `@antelopejs/interface-dms-saas/data-api` | hidden-value data API filters |
| `@antelopejs/interface-dms-saas/db` | canonical SaaS tables and data models |
| `@antelopejs/interface-dms-saas/hidden-filter` | the `HiddenStringFilter` decorator on its own |
| `@antelopejs/interface-dms-saas/invoice-line-items` | provider registration, line item types, line key helpers |
| `@antelopejs/interface-dms-saas/page-definitions` | page and module ids, slugs and descriptors |
| `@antelopejs/interface-dms-saas/pages` | workspace settings category and tenant billing page extensions |
| `@antelopejs/interface-dms-saas/plans` | plan projections, catalog builder, and price normalization |
| `@antelopejs/interface-dms-saas/provisioning` | provisioning hook payload |
| `@antelopejs/interface-dms-saas/registration` | public registration capture limits |
| `@antelopejs/interface-dms-saas/workspace-lifecycle` | workspace lifecycle events and operator actions |

`invoiceLineItems` and `workspaceLifecycle` come off the root entry as
namespaces because each carries an `internal` proxy namespace of its own; `db`
is reachable only through its subpath, since importing it registers the SaaS
tables.

This module declares the interface package name in `antelopeJs.implements`, so as
long as both modules run in the same AntelopeJS project, those imports are
detoured to the running dms-saas instance instead of a second copy pulled from
`node_modules`. Registration goes through an interface proxy on top of that: a
provider registered before dms-saas is constructed is held and replayed on
attach, replayed again when dms-saas is reloaded, and dropped when the
registering module is unloaded.

The interface package must be released before dms-saas, which depends on it
through `>=<interface version> <0.<minor + 1>.0`: dms-saas implements the
interface, so it caps the range below the next minor and a breaking interface
minor never reaches a dms-saas that does not implement it. During workspace
development pnpm resolves that range to the sibling package. Release the interface package first,
then
release dms-saas, and update consumers to the published interface version.

### Public screens

dms-saas ships a working registration screen so a fresh project can sell from
day one. It is a reference implementation, not a design: the module owns the
money and the compliance of the flow, the consuming SaaS owns the conversion.

Replacing it takes two steps. Turn the bundled page off in the module config —
page registration is keyed by slug, so declaring a second page on `register`
races the bundled one instead of overriding it:

```json
{
  "modules": {
    "dms-saas": {
      "config": {
        "publicScreens": { "register": false }
      }
    }
  }
}
```

Then register your own page on the `register` slug and build it on the
`useSaasRegistration()` composable the Vue adapter auto-imports. It holds the
whole flow — the card policy, the Stripe setup intent and card confirmation,
the order the requirements are validated in, the provisioning call and the
landing route — and renders nothing, so a re-themed screen keeps the same
steps:

```vue
<script setup lang="ts">
const {
  form, // name, email, password, hasAcceptedLegal, skipsPaymentMethod
  paymentElementId,
  canSkipPaymentMethod, // true under `optional`
  isPaymentStepVisible, // bind with v-show so the Stripe element stays mounted
  passwordStrength, // { strength, score, color } for <DmsPasswordStrength>
  isRegistrationClosed, // render the invitation-only state instead of the form
  errorMessage,
  isSubmitting,
  submit,
} = useSaasRegistration({ redirectTo: "/welcome" });
</script>
```

Nothing it returns throws: a failure surfaces as a translated `errorMessage`,
and `submit()` resolves to the new tenant id or `null`. A password outside the
DMS policy stops `submit()` before the card is confirmed. The workspace name is
the localised `saas.register.default_workspace_name`. Every screen stays
enabled by default, so an existing project needs no configuration change.

### Registration extras and the provisioning hook

A SaaS that captures its own fields at signup — referral source, team size,
anything — sends them as `extras` on the registration payload and writes them
from a `TENANT_BEING_PROVISIONED` listener. dms-saas forwards the object
verbatim: it never reads it, never stores it, never returns it. The data stays
the consumer's, and so does the schema.

```ts
import type { TenantBeingProvisionedPayload } from "@antelopejs/interface-dms-saas/provisioning";
import {
  Hook,
  RegisterHook,
} from "@antelopejs/interface-dms/hooks";

RegisterHook(
  Hook.TENANT_BEING_PROVISIONED,
  async ({ tenantId, userId, extras }: TenantBeingProvisionedPayload) => {
    await storeOnboardingAnswers(tenantId, userId, extras);
    return undefined;
  },
);
```

`storeOnboardingAnswers` is your module's persistence function. Keep the explicit `undefined` return: this hook's handler contract is `Promise<undefined>`, not `Promise<void>`.

**Contract**

- The hook is emitted inside the provisioning transaction, once the workspace
  is complete and before it is handed back. Listeners run in series and are
  awaited; **a listener that throws cancels the registration** — tenant,
  subscription, Stripe customer and, on the password path, the account itself
  are rolled back. That is the point: a workspace that is paid for but missing
  the data its owner filled in is worse than no workspace.
- It runs while the per-card provisioning lock is held, so a slow listener
  slows every concurrent signup on that card. Write, do not call out.
- `extras` reaches both entry points — password registration and the
  OAuth-entry completion — and is absent when the consumer captured nothing.
- Registration is public and unauthenticated, so `extras` is bounded before it
  is forwarded: **4 KB serialised, 64 keys, 4 levels deep**, and no
  `__proto__` / `constructor` / `prototype` key. Anything above answers 400
  with `saas.errors.registration.extras_*`. `REGISTRATION_EXTRAS_LIMITS` is
  available from `dms-saas/registration` so a consumer can bound
  its own capture first.
- Nothing else in dms-saas depends on a listener existing: with no listener
  registered, registration behaves exactly as before.

On the browser side, `useSaasRegistration()` takes the capture as an option
and sends it with the rest of the form:

```vue
<script setup lang="ts">
const answers = reactive({ referral: "", teamSize: "" });
const { form, submit } = useSaasRegistration({ extras: () => answers });
</script>
```

### Invoice line items

`RegisterInvoiceLineItemsProvider` lets a module bill its own metered usage on
the workspace's subscription invoice. When Stripe opens the renewal invoice of
a billing cycle, dms-saas asks every registered provider for the lines it wants
and pushes them as Stripe invoice items while the invoice is still a draft, so
they are charged on finalization.

dms-saas stays agnostic: it never interprets a line. What a metric is, how it
is measured and how it is priced belong to the provider.

```ts
import {
  RegisterInvoiceLineItemsProvider,
  UnregisterInvoiceLineItemsProvider,
} from "@antelopejs/interface-dms-saas/invoice-line-items";

const PROVIDER_ID = "cloud";

export async function construct(): Promise<void> {
  RegisterInvoiceLineItemsProvider({
    id: PROVIDER_ID,
    resolve: async ({ tenantId, periodStart, periodEnd, currency }) => {
      const usage = await aggregateUsage(tenantId, periodStart, periodEnd);
      return [
        {
          key: "vcpu-minutes",
          description: "vCPU minutes",
          amountCents: usage.vcpuCents,
          quantity: usage.vcpuMinutes,
          unit: "minute",
        },
        {
          key: "included-credit",
          description: "Included usage credit",
          amountCents: -usage.includedCreditCents,
        },
      ];
    },
  });
}

export async function stop(): Promise<void> {
  UnregisterInvoiceLineItemsProvider(PROVIDER_ID);
}
```

**Contract**

- Providers run on `subscription_cycle` invoices only — never on a
  subscription's first invoice nor on one-off invoices, which have no closed
  usage period behind them.
- `periodStart` / `periodEnd` are the boundaries of the **cycle that just
  closed**, not of the upcoming cycle the plan line covers.
- `amountCents` is an integer total in the invoice currency and may be
  negative: that is how a plan's included credit is deducted. Zero-amount lines
  are dropped. A structurally invalid line (non-integer amount, empty key or
  description, oversized or `:`-carrying key) fails the webhook event once
  every provider has run: it is usage that would otherwise never be billed.
- `key` is the unit of idempotency, namespaced by the provider `id`. The same
  key is injected at most once per invoice, whatever the number of webhook
  redeliveries or concurrent workers — so keep it stable across cycles and
  never derive it from a timestamp. Neither `id` nor `key` may contain `:`,
  which joins them, and together they must stay under 150 characters — they
  compose the Stripe idempotency key. `quantity` and `unit` are recorded as
  Stripe metadata for auditability; the amount charged is always
  `amountCents`.
- A resolver that throws is logged and skipped: the other providers still run
  and the invoice is still mirrored. Once every provider has been attempted,
  a partial injection fails the webhook so it surfaces instead of silently
  underbilling the cycle — replays cannot double-charge, every line being
  idempotent.
- Resolvers run inside the Stripe webhook request. Read pre-aggregated
  rollups; a resolver that computes usage on the fly delays the webhook
  response for every provider.
- Register in `construct()`, unregister in `stop()`. An `id` must be unique
  across modules: registering one that is already taken replaces the previous
  provider, whose usage lines then stop being invoiced. Registration is keyed
  by `id` all the way down to the interface proxy — which is both why a clash
  cannot be refused without stranding whichever module registered first, and
  why it is only reported at error level once dms-saas is attached. Two modules
  registering the same `id` before that collapse into one silently, so pick an
  `id` no other module could plausibly choose.
- Resolvers are also called to price the [upcoming invoice
  preview](#upcoming-invoice-preview). Such a call carries `isPreview: true`,
  a synthetic `upcoming_<subscription id>` `invoiceId`, and a `periodEnd` set
  to the time of the request: the running cycle's usage so far. Its lines are
  only quoted to Stripe, never invoiced. A resolver that throws or returns an
  invalid line then makes the preview `unavailable` rather than short.

### Upcoming invoice preview

`GetUpcomingInvoicePreview` returns what Stripe will bill the current
workspace next, tax included, so a page can show the exact VAT and total before
the invoice exists. Stripe computes every figure (Stripe Tax: country, VAT
number, reverse charge); dms-saas copies them without recomputing any.

```ts
import { GetUpcomingInvoicePreview } from "@antelopejs/interface-dms-saas/billing";

const preview = await GetUpcomingInvoicePreview({ tenantId, userId });
if (preview.status === "available") {
  const { taxMinorUnits, totalMinorUnits, currency } = preview;
  render({ tax: taxMinorUnits, total: totalMinorUnits, currency });
}
```

The scope must come from a trusted authentication boundary: the call rejects
with `403` a user who is not a member of the tenant or is refused by the tenant
access gate (a workspace awaiting its first payment, or suspended).

The result is always one of three states, and Stripe errors never throw:

| `status` | Meaning | `reason` |
| --- | --- | --- |
| `available` | Stripe priced the next invoice | — |
| `absent` | Nothing to bill next | `free_plan`, `complimentary`, `customer_not_configured`, `subscription_not_configured` (no plan, or no Stripe subscription yet), `no_upcoming_invoice` (the subscription ends with the current cycle) |
| `unavailable` | An invoice is due but cannot be priced exactly right now; the cause is logged | `stripe_not_configured` (placeholder keys), `tax_not_configured` (Stripe Tax inactive), `tax_location_invalid`, `tax_location_required`, `tax_calculation_failed`, `usage_unavailable` (a line items provider failed), `provider_error` (any other Stripe failure) |

A missing payment method does not prevent a preview: Stripe prices the invoice
all the same.

An `available` preview carries:

- `currency` (uppercase ISO 4217) and integer amounts in its minor units:
  `subtotalMinorUnits` (lines before discounts and tax),
  `totalExcludingTaxMinorUnits`, `taxMinorUnits`, `totalMinorUnits` (tax
  included) and `amountDueMinorUnits` (after the customer balance).
- `taxes`: one entry per tax Stripe applied, with its amount, taxable amount,
  `ratePercentage`, `country`, `taxType` (`vat`…), `taxabilityReason` and
  `isReverseCharge`. `taxCountry` and `isReverseCharge` summarize them; a
  reverse-charged invoice has a zero tax amount and `isReverseCharge: true`.
- `lines`: `subscription` for the plan, `usage` for the lines quoted by the
  [invoice line items](#invoice-line-items) providers (with their
  `usageLineKey`), `invoice_item` for any other pending Stripe item. Each has
  its pre-tax amount, its tax and its period. `hasMoreLines` flags a list
  Stripe truncated; the totals are always complete.
- `periodStart` / `periodEnd` (the cycle the invoice closes), `billingDate`
  (when Stripe issues it), `usageThrough` (how far the quoted usage runs, null
  without usage lines) and `computedAt`. Dates are ISO 8601 strings.

Usage is quoted up to the time of the request with the same providers, paid
coverage window and line validation as the renewal invoice, so the preview's
tax covers plan and usage together. It is an estimate of a cycle still running:
the renewal invoice bills the whole cycle.

Previews are cached per workspace for an hour, shared by every instance through
the database. Set `upcomingInvoicePreviewCacheTtlSeconds` to change that
lifetime, or to `0` to price every request. A cached preview is dropped as soon
as the workspace's subscription (plan change, status) or billing identity
(address, VAT number) changes locally, and when Stripe reports an invoice
created, finalized, paid or voided, a subscription updated or deleted, or a
customer updated. `unavailable` results are never cached. Display
`computedAt` to tell the reader how current the figures are.

### Workspace settings pages

A module adding a page to a workspace's settings takes the side-effect-free
`workspaceSettingsCategory` descriptor from the interface rather than
rebuilding its hierarchy and metadata. The descriptor supports synchronous
`PageController` declarations but is intentionally not reference-equal to the
registered runtime object. Runtime code that requires canonical identity can
await `GetWorkspaceSettingsCategory()` after the SaaS runtime implements the
interface.

```ts
import { PageController, RegisterPage } from "@antelopejs/interface-dms/page";
import { workspaceSettingsCategory } from "@antelopejs/interface-dms-saas/pages";

@RegisterPage()
export class WorkspaceRegistriesController extends PageController("registries", {
  displayName: "$cloud.workspace.registries.title",
  category: workspaceSettingsCategory,
  icon: "i-ph-package",
  order: 10,
}) {}
```

Extensions of the existing tenant billing page register components through
stable page and anchor identifiers. They do not import the page controller,
which would load the module's page registration graph.

```ts
import { CustomComponent } from "@antelopejs/interface-dms/base/custom";
import {
  RegisterTenantBillingPageExtension,
  tenantBillingPage,
  type TenantBillingPageExtensionRegistration,
} from "@antelopejs/interface-dms-saas/pages";

let billingBlocks: TenantBillingPageExtensionRegistration | undefined;

export function construct(): void {
  billingBlocks = RegisterTenantBillingPageExtension({
    name: "CloudBillingBlocks",
    components: [
      {
        key: "inProgressInvoice",
        component: CustomComponent("CloudInProgressInvoice"),
        side: "after",
        anchorKey: tenantBillingPage.components.planCard,
      },
    ],
  });
}

export function stop(): void {
  billingBlocks?.unregister();
  billingBlocks = undefined;
}
```

Platform modules can extend the SaaS platform-owner workspace detail without
importing its controller or the private `saasModule` instance. Use
`platformSaasModule`, `platformWorkspaceDetailPage`, and
`RegisterPlatformWorkspaceDetailPageExtension` from the same public `pages`
entry point. `platformSaasModule` is also a synchronous descriptor; runtime
code that requires the registered module root can await
`GetPlatformSaasModule()`. Platform data controllers that must hide a tenant
routing field can import `HiddenStringFilter` from
`@antelopejs/interface-dms-saas/data-api`; the underlying
SaaS data controllers and database models remain private.

### Platform-owner operations and workspace lifecycle

The platform-owner workspace page provides suspension, reactivation, immediate
Stripe-backed upgrades, and Stripe customer-balance credits. Every request
uses a caller-supplied operation ID and creates a private durable command intent
before any Stripe or lifecycle effect. The command state retains the actor,
tenant, action, redacted-safe values, attempts, outcome, and effective time.
Retrying the same ID and values resumes an eligible failed operation; reusing
it with different values is rejected.

Operator attempts do not use leases or timed takeover. A definitive failure
whose execution has finished may retry with the same operation and provider
payload for 23 hours from intent creation. This preserves a one-hour margin
inside Stripe's minimum 24-hour idempotency retention. An unknown outcome,
including lost journal acknowledgement, requires reconciliation instead.

Suspension, reactivation, and immediate plan changes persist a subscription
transition before effects. Its revision fences competing local transitions and
deletion; the operator journal must succeed before its intent is cleared.
An ordinary subscription write rejects pending transitions and deletion markers.
This does not provide distributed transactions or fence an external request
that has already left the process.

Inspect an operation through the platform-owner-only endpoint
`GET /api/saas/workspaces/:tenantId/operations/:operationId`. A running or
reconciliation-required operation may have an old executor still active.
Before resolving it, establish **both** that the previous executor is stopped
or quiescent and what happened externally, using the persisted operation,
provider request details, and provider records. A matching Stripe read alone
does not establish quiescence. There is deliberately no force-success endpoint
that clears the intent without those proofs. This trades automatic crash
recovery and availability for protection against conflicting external effects.

Bulk plan migrations capture an immutable workspace list and resolved target
configuration before admitting an execution. Each workspace gets a persisted
outcome and a subscription transition before provider effects. A crash after
changing `planId` does not remove that workspace from the snapshot. Running
jobs never use timed takeover; startup marks interrupted jobs as
`reconciliation_required`, retaining their per-workspace evidence and pending
subscription intents instead of blindly replaying effects.

The `migrate-and-delete` endpoint requests a migration only.
Inspect `GET /api/saas/plans-deletion/migrations/:migrationId` for the snapshot,
outcomes, and reconciliation requirements. **Snapshot completion does not retire
the source plan.** The source remains available even at zero observed references;
workspaces arriving after capture are outside this job. Any later retirement
requires a separate procedure that establishes writer quiescence. A current
reference count cannot exclude a suspended writer that already validated the plan.

Migration reconciliation requires stopping or proving quiescence of the prior
executor and establishing the provider, subscription, permission-cleanup, and
notification outcomes. A target `planId` or matching Stripe response alone is
not sufficient. Failed core lifecycle admissions may also remain closed to
destruction until their evidence is resolved. There is no automatic force-success
or effect-replay endpoint; arbitrary hooks are not made idempotent by a job ID.

Self-service cancellation, deferred plan changes, and administrative free grants
also admit subscription intent before Stripe effects. An ambiguous schedule
replacement retains the previous mirror and pending intent; it does not attempt
to restore or erase provider state blindly. Owners can inspect these intents and
the irreversible deletion marker through the workspace `admin-state` endpoint.

Checkout holds a `checkout` intent until the exact recorded session completes
or expires. Completion admits one callback executor and writes a terminal session
receipt only after its awaited provider effects finish. Unknown callback outcomes
retain intent rather than enabling timed replay. A session whose ID was never
acknowledged locally requires manual reconciliation, including executor quiescence.
Trial reservations are permanent across checkout expiration; uncertain attempts
do not receive another trial. Checkout automation remains best-effort, outside
the terminal receipt, and does not promise exactly-once delivery or external order.

Stripe webhook dispatch admits an event once and fences completion with its
admitted revision. An old `pending` record never permits timed takeover. Handler
failures become `reconciliation_required`, which blocks replay because the
attempt may have partial effects. Redelivery receives an error while unresolved, rather than a successful acknowledgement or another execution.

Inspect `stripe_webhook_events` by Stripe event ID for its result, revision, and
error message. Recovery requires establishing the prior executor's quiescence
and the handler's database and external outcomes; do not delete the admission
or resend blindly. There is no automatic recovery endpoint. Unresolved records
remain indefinitely. The existing retention policy still removes old terminal
`success`/`skipped` receipts, so deduplication is not guaranteed after that window.

Revision mutations require the published database interface `0.1.6` or later
and an adapter implementing that contract. The MongoDB test adapter uses `1.3.1`,
and any DMS release carrying this module satisfies the requirement. Every
record is written with a revision, and these mutations refuse a record without
one; see [Upgrading](#upgrading) for rows written by earlier builds.

Lifecycle-dependent modules register a required consumer through the public
interface:

```ts
import {
  RegisterWorkspaceLifecycleConsumer,
  type WorkspaceLifecycleConsumerRegistration,
} from "@antelopejs/interface-dms-saas/workspace-lifecycle";

let lifecycleRegistration: WorkspaceLifecycleConsumerRegistration | undefined;

export function construct(): void {
  lifecycleRegistration = RegisterWorkspaceLifecycleConsumer({
    name: "cloud.workspaces",
    transitions: ["suspended", "reactivation_requested"],
    async consume(message) {
      const receipt = await applyWorkspaceLifecycle(message);
      return {
        receiptId: receipt.id,
        effectiveAt: receipt.effectiveAt,
      };
    },
  });
}

export function stop(): void {
  lifecycleRegistration?.unregister();
  lifecycleRegistration = undefined;
}
```

Registration may happen before dms-saas construction: dms-saas replays buffered
consumers when it attaches its module-owned registry. Registrations are removed
automatically when their owning module unloads; the explicit handle remains
available for module stop compatibility. Register required consumers during
module construction, before module startup reconciliation. Messages carry
stable `tenantId` and `operationId` values. Deliveries and receipts are
persisted; a persisted success is skipped on later retries. Concurrent
reconcilers may invoke the same consumer more than once before its receipt is
persisted. Consumers must deduplicate concurrent calls by operation identity;
the outbox does not provide exactly-once execution or ordering of external
effects. Failed deliveries remain available to startup reconciliation and a
five-minute retry worker. Suspension
closes SaaS access before consumer delivery. Reactivation keeps SaaS access
closed until every required consumer returns a durable receipt; the consumer
therefore owns any product-specific sleep or wake work.

#### Successful workspace creation

Provisioning reserves free-workspace capacity per card and trial eligibility
per email/card identity before issuing provider effects. Reservations do not
expire. An unknown provider or persistence outcome keeps the reservation and
the account for reconciliation; the service never replays opaque provisioning
hooks or stores their `extras`. Known provider handles and the attempt ID are
persisted separately from billing profiles. Stripe customer metadata also
contains the attempt ID for investigating a lost creation response.

Platform owners inspect the first 100 unresolved records through
`GET /api/saas/workspaces/provisioning-attempts` and an individual record through
`GET /api/saas/workspaces/:tenantId/provisioning-attempt`. Preparing records can
represent an executor that disappeared before recording its error. Establish
executor quiescence, provider cancellation or successful creation, and tenant
closure before repairing a record or releasing an allocation. This release
does not provide an automated repair command. Never release uncertain
reservations by age or re-run non-idempotent hooks with guessed input.

Every consumer declares the transitions it handles, for example
`transitions: ["created"]` for creation only or all three when it also handles
suspension and reactivation. A consumer must return a durable receipt and
deduplicate effects by `operationId`:
`workspace-created:<tenantId>` remains stable across delivery retries.

Self-service provisioning writes a creation marker in the existing lifecycle
outbox **before inserting the tenant**. Only after ownership, billing records
and every `TENANT_BEING_PROVISIONED` listener succeed does it allow payment
confirmation. Trials and creations without an invoice require no payment;
zero-total invoices already marked paid are not paid again. An invoice-backed
creation becomes committed only after Stripe reports its first invoice paid.
Consumer failures never roll back committed workspaces.

Inventory reconcilers must check the public provisioning gate before creating
external resources. This check prevents a concurrent inventory scan from
provisioning a tenant whose membership, hooks or payment are still incomplete.
It does not replace tenant existence, authorization or suspension checks.

```ts
import { IsWorkspaceProvisioningCommitted } from
  "@antelopejs/interface-dms-saas/workspace-lifecycle";

async function reconcileTenant(tenantId: string): Promise<void> {
  if (!(await IsWorkspaceProvisioningCommitted(tenantId))) return;
  await ensureWorkspaceResources(tenantId);
}
```

The gate returns true for legacy/default/bootstrap tenants without a creation
marker. It returns false for preparing, unpaid or cancelled creations, and
propagates storage failures; callers must fail closed. Cancellation leaves a
tombstone so even a partial rollback cannot make an orphaned tenant eligible.
Do not delete these markers while the tenant may remain in an inventory.

Reconciliation recovers a crash after successful payment but before delivery,
partial consumer fan-out and lost receipts. It may deliver a message again
when a consumer commits its effect before the receipt is saved. Consumers must
make their resource creation and ownership linkage idempotent. Delivery skips
tenants already deleted when the attempt starts; consumers must also tolerate
deletion racing with an in-flight attempt.

A definitive card decline permits rollback only after tenant lifecycle
admission closes and all required deletion hooks succeed. An incomplete
closure preserves data, account ownership, and recovery markers. Rollback
never drops the tenant schema or the lifecycle/invitation tombstones. An
ambiguous payment error preserves the tenant and account because a timeout can
hide a successful charge. Reconciliation checks payment status but never starts
another charge. A crash before payment, an unpaid ambiguous result, or an
interrupted pre-payment preparation requires payment/provisioning recovery;
it never emits `created` merely because the tenant exists. HTTP creation requests
are not made idempotent by the delivery operation ID.

Register consumers before startup reconciliation; use the existing
tenant inventory and gate for bootstrap/backfill rather than treating `created`
as a historical inventory API.

## Upgrading

### Rows written by earlier builds

Billing no longer infers state from rows that predate the current fields. Rows
imported from the pre-DMS codebase or written by earlier builds must be fixed
in the database, with writers stopped, before upgrading:

- **`features.displayName` and `features.tooltip`** are localized. Rows
  written by earlier builds hold a plain string (often a `$` i18n key) that
  the localized readers cannot use. Drop the `features` table and let the
  declaring modules write it again on startup, then re-enter any feature
  created by hand.
- **`tenant_subscriptions.isComplimentary`** is required. Only
  `isComplimentary: true` makes a subscription complimentary; a missing value
  is read as not complimentary. Set `isComplimentary: true` on admin gifts that
  lack it (typically rows with no `stripeCustomerId`, no `stripeSubscriptionId`
  and a status other than `pending_payment`), otherwise they are billed and
  shown as paid plans. Backfill `isComplimentary: false` on every other row
  that lacks the field, including workspaces created through paid provisioning
  before this change, so the stored rows match the table type.
- **`invoices.documentType`** is required. Invoice lists and reads only match
  `documentType: "invoice"`; a row without it is neither listed nor readable.
  Set `documentType: "invoice"` on every invoice row that lacks it.
- **`stripe_webhook_events.result`** no longer accepts `failed`. Such attempts
  may carry partial effects: establish their outcome as described for
  `reconciliation_required` above, then set their result to
  `reconciliation_required` or delete the record once resolved.
- **`revision`** is required on `tenant_subscriptions`, `segments`,
  `user_segments`, `plan_migrations`, `stripe_webhook_events`,
  `saas_lifecycle_deliveries` and `saas_operator_actions`. Revision-fenced
  writes no longer adopt a row without one: they refuse it, so the workflow
  holding that row stalls. Give every row lacking the field (absent or `null`)
  an initial revision, any unique string such as a fresh UUID. Segments created
  through the platform data API by earlier builds are the usual case.
- **`tenant_subscriptions.paidUsagePeriods`** is required. It is the only
  source of usage coverage: a renewal invoice bills usage only inside a period
  recorded for its own Stripe subscription, and a missing ledger is no longer
  read as "bill the whole window". Rows lacking it (or holding `null`) are
  typically default-plan, free-plan and pending-checkout subscriptions, and
  workspaces created through paid provisioning. Set it by kind:
  - a row with a `stripeSubscriptionId`, not complimentary:
    `[{ stripeSubscriptionId, start, end: null }]`, where `start` is the Stripe
    subscription's `start_date` (or any earlier date), so renewals keep billing
    their whole window;
  - every other row (no Stripe subscription, or `isComplimentary: true`): `[]`.
