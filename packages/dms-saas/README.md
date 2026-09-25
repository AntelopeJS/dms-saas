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
Public module configuration moves from `public.cmsSaas` to `public.dmsSaas` —
a breaking change for any frontend reading the old key. Stripe secrets are
never exposed to the frontend.

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

## Native support tickets

The Support page stores tickets, messages, and ticket events in the active
tenant schema. Platform ticket listing uses `CROSS_INSTANCE`; MongoDB's
`_instance` identifies each ticket's tenant. Detail reads and writes use that
tenant's scoped models.

Support listings use the Data API endpoints:

- `/api/saas/tenant/tables/support-tickets/list`
- `/api/saas/tables/support-tickets/list`
- `/api/saas/tables/support-owners/list`
- Existing tenant and platform detail URLs, with `/messages/list` and
  `/events/list` children (and `/count` variants)

List queries accept `offset`, `limit`, `sortKey`, `sortDirection`, and
`filter_<field>`. Responses contain `{ results, total, offset, limit }`. Owner
rows contain `_id`, `name`, and `email`. Global ticket rows include the joined
`tenantName`.

Pages default to 20 rows and are capped at 100. String filters use the DMS
comparison modes, for example `filter_status=is:open`. Recent-first reads keep
timestamp/ID compound ordering. Message and event pagination loads only the
requested collection; ticket scope is enforced by the server.

Status and assignment changes record the actor, previous/new values, and time
in `support_ticket_events`. This includes automatic reply transitions: support
replies wait for the customer, and customer replies resume tickets waiting for
them. Existing tickets start with no historical events; old history is not
invented. Existing central mirror data is unused and is not automatically deleted.

Support level comes from the inherited plan feature whose id is
`support-sla`. Supported string values are `community`, `email`, `priority`,
and `dedicated`. An absent or invalid value falls back to community support.
Those levels respectively expose normal; low/normal; low/normal/high; and all
priorities. Displayed first-response targets are no guarantee, 48 business
hours, 8 business hours, and 2 elapsed hours.

Attachments use the DMS upload token and staging flow below the tenant-bound
`support-attachments/{tenantId}` path. A message accepts up to five image, PDF,
or text files of 10 MiB each. Only staged keys from that tenant path are
accepted, each is promoted before the tenant message is persisted, and failed
writes move promoted files back to staging. Ticket-specific metadata routes
verify that a key belongs to the requested thread before issuing its read URL.

## Registration

Public registration is short: an account (name, e-mail, password) and the
acceptance of the terms, plus a card when the deployment asks for one. The
workspace it opens lands on the catalogue's first free plan — the lowest
`order` among active plans priced 0 and open to individuals — under a default
name its owner renames from the workspace settings. Customer type, billing
address, VAT number and plan choice belong to the upgrade flow. Registration
answers `409 saas.errors.plan.no_free_plan` while the catalogue has no such
plan.

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
server (`payment_method_types: ["card"]`); the Payment Element is created from
its client secret alone, since Stripe refuses `paymentMethodTypes` next to a
`clientSecret`.

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

## Plan feature labels and values

A feature row stores one display name and one tooltip, in no particular
language. The tenant plan pages (the plan card summary and the plan comparison
table) look for a translation first, for feature `<featureId>`:

1. `<prefix>.<featureId>.label` and `<prefix>.<featureId>.tooltip` for each
   prefix of `planFeatureTranslationPrefixes`, in order;
2. `saas.plan_features.<featureId>.label` / `.tooltip`;
3. the stored display name and tooltip.

A module translates the features it declares by shipping the keys in its own
frontend locale files (`frontend-vue/i18n/locales/<name>-<locale>.json`) and
naming its prefix in the dms-saas config:

```json
{ "modules": { "dms-saas": { "config": { "planFeatureTranslationPrefixes": ["cloud.plan_features"] } } } }
```

Keys are dot paths, so a feature id containing dots nests: the label of
`cloud.price.cpu_minutes` under `cloud.plan_features` lives at
`cloud.plan_features.cloud.price.cpu_minutes.label`. A key missing in the
viewer's locale falls back to the fallback locale, then to the stored text.

Values are formatted from the feature's `valueType` and `unit`: `-1` reads as
unlimited, booleans as ✓/—, numbers are grouped in the viewer's locale. A
`per <unit>` unit makes the value a price in the plan's currency, and
`currency units` an amount of it. Known units are scaled to something a person
reads at a glance; any other unit is shown verbatim after the grouped number.

| Stored unit | Quantity reads as | `per <unit>` price reads as |
|-------------|-------------------|-----------------------------|
| `byte(s)` | bytes, KB, MB, GB or TB (powers of 1000) | per GB |
| `vCPU-minute(s)` | vCPU-hours | per vCPU-hour |
| `GiB-minute(s)`, `GB-minute(s)` | GiB-hours, GB-hours | per GiB-hour, per GB-hour |
| `GB-hour(s)` | GB-months (730 hours) | per GB-month |
| `minute(s)`, `build minute(s)` | minutes, build minutes | per minute, per build minute |

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
| `@antelopejs/interface-dms-saas/billing` | customer balance and complimentary subscription state |
| `@antelopejs/interface-dms-saas/data-api` | hidden-value data API filters |
| `@antelopejs/interface-dms-saas/db` | canonical SaaS tables and data models |
| `@antelopejs/interface-dms-saas/hidden-filter` | the `HiddenStringFilter` decorator on its own |
| `@antelopejs/interface-dms-saas/invoice-line-items` | provider registration, line item types, line key helpers |
| `@antelopejs/interface-dms-saas/page-definitions` | page and module ids, slugs and descriptors |
| `@antelopejs/interface-dms-saas/pages` | workspace settings category and tenant billing page extensions |
| `@antelopejs/interface-dms-saas/plans` | plan projections, catalog builder, and price normalization |
| `@antelopejs/interface-dms-saas/provisioning` | provisioning hook payload |
| `@antelopejs/interface-dms-saas/registration` | public registration capture limits and card policies |
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
through `>=<interface version> <1.0.0`; during workspace development pnpm
resolves that range to the sibling package. Release the interface package first,
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
  isRegistrationClosed, // render the invitation-only state instead of the form
  errorMessage,
  isSubmitting,
  submit,
} = useSaasRegistration({ redirectTo: "/welcome" });
</script>
```

Nothing it returns throws: a failure surfaces as a translated `errorMessage`,
and `submit()` resolves to the new tenant id or `null`. The workspace name is
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

The historical `migrate-and-delete` endpoint now requests migration only.
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
failures become `reconciliation_required`; legacy `failed` records also block
replay because they may contain partial effects. Redelivery receives an error
while unresolved, rather than a successful acknowledgement or another execution.

Inspect `stripe_webhook_events` by Stripe event ID for its result, revision, and
error message. Recovery requires establishing the prior executor's quiescence
and the handler's database and external outcomes; do not delete the admission
or resend blindly. There is no automatic recovery endpoint. Unresolved records
remain indefinitely. The existing retention policy still removes old terminal
`success`/`skipped` receipts, so deduplication is not guaranteed after that window.

Revision mutations require the published database interface `0.1.6` or later
and an adapter implementing that contract. The MongoDB test adapter uses `1.3.1`,
and any DMS release carrying this module satisfies the requirement. New records
initialize revisions; legacy PostgreSQL rows with a declared revision column
require an explicit revision backfill
before these mutations can proceed. An absent revision is not equivalent to
`null`, and unsupported bootstrap fails closed. Do not run this backfill against
shared data without a separately approved migration and quiescent writers.

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

These additions require a dms-saas package built from this source revision (or
a later release containing it), including its lifecycle table fields and worker.
The previously published `0.2.5` package does not provide the gate or `created`
contract. Register consumers before startup reconciliation; use the existing
tenant inventory and gate for bootstrap/backfill rather than treating `created`
as a historical inventory API.

## Support attachment storage and recovery

Configure `supportStorage` with an explicit named file-storage definition. Support
issues private staged uploads through its tenant-member `/api/saas/support/uploads`
route and persists the tenant, source key and storage name before returning the
upload capability. Native `/api/files` routes do not authorize support files.
Support read routes check ticket/message membership before minting a read URL.

Keep every old named storage definition unchanged while its uploads, receipts or
files remain live. Selecting a new `supportStorage` name affects only new uploads;
existing receipts retain their original routing. Unknown names fail closed. A name
does not identify a provider incarnation and cannot detect remapping that same
name to a different backend. Use isolated nonreused keys and prevent privileged or
external writers from modifying support objects.

The storage adapter must provide write-once uploads and dedicated no-clobber
`PromoteFile`, with trusted-origin replay and private visibility preservation.
Promotion moves a staged upload to its canonical key without the staging prefix;
support never retains an expiring staged key as the published reference. Support
records positive promotion confirmation before validating final metadata, then
uses the existing database operation receipt to authorize publication. Published
prerequisites are the database interface `0.1.6`, the storage interface `0.1.3`,
and a compatible provider: local `0.1.4` or S3 `0.1.3`, all of which any DMS
release carrying this module provides. Tests use MongoDB `1.3.1`.
There is no legacy move/existence fallback.

Source admissions remain insert-only and permanent. Rejected work cannot publish,
even if a delayed promotion finishes. Owner-initiated paginated support recovery
repeats ordinary deletion of owned rejected sources and positively confirmed
finals. It never promotes rejected work just to establish cleanup ownership and
never deletes an unconfirmed or foreign final. Uncertain acknowledgements can
therefore retain private orphans. Recovery is not autonomous garbage collection;
operators must repeat complete passes, including after delayed uploads finish.
Already issued signed read URLs remain valid until their normal expiry.

Never-submitted upload receipts have no operation to recover. Configure provider
staging expiry for abandoned bytes; permanent issuance/admission metadata is not
automatically collected. Upload capabilities and in-flight writes can outlive a
cleanup pass, so storage expiry/operational cleanup must account for them. Do not
delete receipts to free a source for another request or garbage-collect a file
that a committed support message still references.

The earlier draft seal schema has no production installations and is replaced,
not migrated online. If retaining development fixtures from that draft, stop
writers and reconcile or discard those disposable support fixtures and their
private files offline before adopting this schema. Do not reinterpret old seal
records as confirmed promotion ownership.
