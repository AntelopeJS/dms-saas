---
covers:
  - packages/dms-saas/src/routes/public/register.ts
  - packages/dms-saas/src/pages/public/register.ts
  - packages/dms-saas/src/pages/public/auth/**
  - packages/dms-saas/src/auth/oauth-entry.ts
  - packages/dms-saas/src/hooks/tenant-provisioning.ts
  - packages/dms-saas/src/workspaces/provisioning*.ts
  - packages/dms-saas/src/workspaces/registration-extras.ts
  - packages/dms-saas/src/workspaces/free-workspaces-per-card.ts
  - packages/dms-saas/src/workspaces/free-plan.ts
  - packages/dms-saas/src/workspaces/billing-profile.ts
  - packages/dms-saas/src/workspaces/billing-identity*.ts
  - packages/dms-saas/src/workspaces/owner-contact.ts
  - packages/dms-saas/src/workspaces/workspace-owner.ts
  - packages/dms-saas/src/workspaces/workspace-name.ts
  - packages/dms-saas/src/workspaces/subscription-create-params.ts
  - packages/dms-saas/src/workspaces/first-payment.ts
  - packages/dms-saas/src/workspaces/index.ts
  - packages/dms-saas/src/workspaces/db/**
  - packages/dms-saas/frontend-vue/app/components/Register.vue
  - packages/dms-saas/frontend-vue/app/components/RegistrationClosed.vue
  - packages/dms-saas/frontend-vue/app/components/BillingIdentityFields.vue
  - packages/dms-saas/frontend-vue/app/composables/useSaasRegistration.ts
  - packages/dms-saas/frontend-vue/app/composables/registrationCardPolicy.ts
  - packages/dms-saas/frontend-vue/app/composables/useSaasRegistrationPlan.ts
  - packages/dms-saas/frontend-vue/app/composables/useBillingIdentity.ts
  - packages/dms-saas/frontend-vue/app/composables/useBillingAddress.ts
  - packages/dms-saas/frontend-vue/app/composables/useBillingCountries.ts
  - packages/dms-saas/frontend-vue/app/composables/useStripePaymentElement.ts
  - packages/dms-saas/frontend-vue/app/custom-pages/**
  - packages/dms-saas/frontend-vue/app/plugins/auth-links.ts
  - packages/dms-saas/frontend-vue/app/build/public/Registration*.vue
  - packages/dms-saas/frontend-vue/app/build/public/registration-errors.ts
  - packages/dms-saas/frontend-vue/app/build/public/chosen-plan.ts
  - packages/dms-saas/frontend-vue/app/build/public/LegalAcceptance.vue
  - packages/dms-saas/frontend-vue/app/build/public/access.ts
  - packages/dms-saas/frontend-vue/app/build/public/AccessTimeline.vue
  - packages/dms-saas/frontend-vue/app/build/public/OtherWorkspaces.vue
  - packages/dms-saas/src/config/**
  - packages/dms-saas/src/types/**
  - packages/dms-saas/src/pages/public/screens.ts
  - packages/dms-saas/src/pages/module.ts
  - packages/dms-saas/src/pages/definitions.ts
  - packages/dms-saas/src/pages/block-meta.ts
  - packages/dms-saas/src/pages/index.ts
  - packages/dms-saas/src/routes/public/index.ts
  - packages/dms-saas/src/routes/public/pricing.ts
  - packages/dms-saas/src/routes/public/public-plan-catalog.ts
  - packages/dms-saas/src/routes/public/legal-documents.ts
  - packages/dms-saas/src/pages/public/pricing.ts
  - packages/dms-saas/src/pages/public/nav-bar.ts
  - packages/dms-saas/src/pages/public/index.ts
  - packages/dms-saas/src/pages/public/legal/**
  - packages/dms-saas/frontend-vue/app/components/Pricing.vue
  - packages/dms-saas/frontend-vue/app/components/PlanCardPublic.vue
  - packages/dms-saas/frontend-vue/app/components/PublicNavBar.vue
  - packages/dms-saas/frontend-vue/app/components/LegalLayout.vue
  - packages/dms-saas/frontend-vue/app/composables/usePublicPricing.ts
  - packages/dms-saas/frontend-vue/app/plugins/footer-links.ts
  - packages/dms-saas/frontend-vue/app/build/public/PricingComparison.vue
  - packages/dms-saas/frontend-vue/app/build/public/PricingFaq.vue
  - packages/dms-saas/frontend-vue/app/build/public/PublicStage.vue
  - packages/dms-saas/frontend-vue/app/build/public/usePublicFetch.ts
  - packages/dms-saas/frontend-vue/app/build/public/legal.ts
  - packages/dms-saas/frontend-vue/app/build/public/legal-html.ts
  - packages/dms-saas/frontend-vue/app/build/public/routes.ts
  - packages/dms-saas/frontend-vue/app/build/public/pricing.ts
  - packages/dms-saas/frontend-vue/app/build/public/usePublicPlanFormat.ts
docs:
  - packages/dms-saas/docs/4.usage/1.public-screens.md
  - packages/dms-saas/docs/3.configuration.md
  - packages/dms-saas/docs/6.faq.md
  - packages/dms-saas/docs/2.installation.md
  - packages/dms-saas/docs/4.usage/8.billing-rules.md
---

# Public

Public registration and the options that shape it: the account and first workspace on the default free plan, the card step per `registration.paymentMethod`, invitation-only admission, registration extras, the sign-in completion without a workspace, the public pricing catalogue, the default plan slug, the public screens that can be switched off, and the options the module refuses at start.

## Sub-features

- `a-visitor-registers-onto-the-default-plan`: a registration opens a workspace on the free plan with a default or trimmed name, and refuses a taken e-mail.
- `the-password-policy-is-checked-before-anything-is-created`: a password outside the DMS policy is refused with 400 before the e-mail is looked up, and nothing is created.
- `registration-needs-a-free-plan-open-to-individuals`: without an active free plan open to individuals registration answers 409, with it the lowest order wins.
- `the-card-step-follows-the-payment-method-option`: required asks for a card, optional and none do not, and a deployment without a usable Stripe key applies none, on the server and on the register screen.
- `invitation-only-closes-every-registration-route`: invitation-only answers 403 saas.errors.registration_closed on every register route and leaves pricing open.
- `extras-reach-the-provisioning-listeners-within-their-limits`: registration extras are forwarded verbatim to TENANT_BEING_PROVISIONED listeners and bounded to 4096 bytes, 64 keys and depth 4.
- `a-sign-in-without-a-workspace-is-completed`: an account with no workspace is described, then finalized into a workspace and a session, once.
- `the-pricing-catalogue-lists-public-plans-in-order`: the public catalogue lists active public plans by order, hides the rest, and names the default plan only when it is on sale.
- `a-listener-that-throws-cancels-the-registration`: a TENANT_BEING_PROVISIONED listener that throws fails the registration and leaves nothing behind, so the same address can register again.
- `pricing-lists-plans-in-catalogue-order-with-the-documented-call-to-action`: /pricing orders plans by catalogue order whatever their price, and each card says Start free, Start N-day trial or Choose followed by the plan name.
- `a-wrong-option-stops-the-module-at-start`: an admission mode, a registration payment method or a preview cache lifetime outside the documented values stops the backend at start, and the boundary values start.
- `a-default-plan-slug-picks-among-the-free-plans`: defaultPlanSlug picks a usable free plan, and a slug naming none is ignored in favour of the lowest-ordered free plan.
- `a-screen-switched-off-frees-its-slug`: publicScreens.register false and publicScreens.pricing false stop the module serving those pages, and the public catalogue API stays.
- `registration-answers-429-past-its-rate-limit`: one client address registers 20 times in a minute, the 21st call answers 429 with Retry-After and creates no account, and a restart of the backend starts a new count.
- `a-plan-saved-without-a-billing-mode-keeps-the-pricing-page-up`: the pricing page renders a public plan that was saved through the API without a billing mode, as a flat rate, and a billing mode outside flat and seat is refused with 400.

## How to get to it (user POV)

- `/register`, `/pricing`, `/auth/no-workspace`, `POST /api/saas/register`, `GET /api/saas/pricing`, and `antelope.config.ts` for the options.

## Driving it with dms-control

```bash
dms-control journey "$RUN" public
```

## Gotchas

- `registration.paymentMethod` is driven with a placeholder key (the server applies `none`) and with a usable-looking key `sk_test_verifysaaslocal`: the checks that need it refuse before any Stripe call, so nothing is sent to Stripe.
- Options are set through `VERIFY_SAAS_*` variables of `playground/antelope.config.ts` and a backend restart (`withConfig`).
- Known finding: `invitation-only-closes-every-registration-route` fails at its last step. After the backend restarts with `admission: "invitation-only"` while the frontend server keeps running, `/register` renders the 500 page ("The core error.500.description translation must be loaded") instead of the closed screen. A backend started in invitation-only, or restarted without changing the option, renders the closed screen. Every API check of the journey passes.
- Plans are created with `audience: "any"` and `billingMode: "flat"`, as the editor sends them.

## Coverage

| Documented behaviour | Journey check or reason |
| --- | --- |
| 1.public-screens.md "Registration" | registration journeys: default plan, trimmed name, taken e-mail, password policy, payment modes |
| 1.public-screens.md "Pricing" | pricing-catalogue journey for the catalogue API; Not driven: the card CTA wording (Start free, Start N-day trial, Choose), the Monthly/Yearly switch, Compare plans and the FAQ: they are client-rendered text |
| 1.public-screens.md "Registration" (invitation-only) | invitation-only journey: every route 403 and the closed screen; the closed screen fails on a product finding (see Gotchas) |
| 1.public-screens.md "Sign-in" | Not driven: the sign-up and pricing links of /auth are drawn by a frontend plugin; no check reads them |
| 1.public-screens.md "Completing a sign-up without a workspace" | sign-in completion journey (pending, finalize, twice); Not driven: the /auth/establish cookie exchange of the frontend server |
| 1.public-screens.md "Legal pages" | billing-rules: saving-a-legal-text-publishes-a-new-version |
| 1.public-screens.md "Suspended workspace" | workspace: suspension journey; Not driven: the reason wording and the owner's recovery buttons of /workspace-suspended |
| 3.configuration.md Options table | start-refusal journey (admissionMode, paymentMethod, cache TTL), default-plan journey, screens journey; Not driven: stripe.readTimeoutMs, stripe.readMaxNetworkRetries, allowedRedirectHosts (only used for Stripe redirects), reportingCurrency (dashboard feature), requiredPlanChangePolicy, invoiceLineRequiredProviders and invoiceLineRecoveryDiscoverySince (need Stripe invoices) |
| 3.configuration.md "Registration" | payment-method journey; extras journey; Not driven: the free-workspace-per-card cap (needs a card fingerprint) |
| 3.configuration.md "When Stripe cannot be used" | Not driven: needs a usable key and a Stripe that refuses; without a key the 503 saas.errors.stripe.not_configured refusals are the observable part |
| 3.configuration.md "Default plan" | default-plan journey (including the first free plan attaching to a workspace that had none) and registration-needs-a-free-plan journey |
| 3.configuration.md invitation-only: workspace creation in the app closed except for a platform owner | invitation-only journey: create-options 403 for an owner, 200 for the platform admin |
| 5.extending.md a failing TENANT_BEING_PROVISIONED listener cancels the registration | listener journey: the registration fails and the address registers afterwards |
| 6.faq.md "Registration answers 409 saas.errors.plan.no_free_plan" | registration-needs-a-free-plan journey |
| 6.faq.md "A visitor who just registered stays signed out" | Not driven: the frontend server's establish endpoint allow-list |
| 1.public-screens.md Pricing order and call to action | pricing journey: catalogue order whatever the price, Start free, Start N-day trial, Choose plan |
