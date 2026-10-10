import type {
  BillingSettings,
  LegalDocuments,
} from "@antelopejs/interface-dms-saas/db";
import { PLAN_IDS } from "./catalogue";
import { ADMIN_ID, HUGO_ID, SOFIA_ID } from "./people";
import { WORKSPACE_IDS } from "./workspaces";
import type { SeedPlanMigration, SeedPlatformNote, SeedSegment } from "./types";

const W = WORKSPACE_IDS;
const P = PLAN_IDS;

export type SeedBillingSettings = Omit<BillingSettings, "_id" | "updatedAt">;

export const BILLING_SETTINGS: SeedBillingSettings = {
  autoSuspendEnabled: true,
  autoSuspendDelayDays: 14,
  dataRetentionDaysAfterCancellation: 30,
  maxFreeWorkspacesPerCard: 1,
  moneyBackGuaranteeEnabled: true,
  moneyBackGuaranteeWindowDays: 14,
  moneyBackGuaranteeMode: "prorated",
  autoProrataOnCancelEnabled: true,
  stripeTaxCode: "txcd_10000000",
};

export type SeedLegalDocuments = Omit<LegalDocuments, "_id" | "updatedAt">;

export const LEGAL_DOCUMENTS: SeedLegalDocuments = {
  termsOfUse: [
    "<h2>1. Who we are</h2>",
    "<p>Antelope is operated by Antelope SAS, 10 rue de Rivoli, 75004 Paris, France.</p>",
    "<h2>2. Your account</h2>",
    "<p>Keep your credentials private. You are responsible for what happens under your account.</p>",
    "<h2>3. Acceptable use</h2>",
    "<p>Do not use the service to send spam, host illegal content or probe other customers.</p>",
  ].join(""),
  termsAndConditions: [
    "<h2>1. Subscriptions</h2>",
    "<p>Plans renew automatically at the end of each period until cancelled from Billing.</p>",
    "<h2>2. Payment</h2>",
    "<p>Invoices are charged to the card on file. A workspace that stays unpaid for 14 days is suspended.</p>",
    "<h2>3. Refunds</h2>",
    "<p>The first payment of a workspace can be refunded within 14 days, prorated to the unused days.</p>",
  ].join(""),
  privacyPolicy: [
    "<h2>1. What we collect</h2>",
    "<p>Account details, workspace content and billing information, nothing more.</p>",
    "<h2>2. Who processes your data</h2>",
    "<ul><li>Stripe Payments Europe — payments and invoices</li>",
    "<li>Scaleway — hosting in Paris, France</li>",
    "<li>Postmark — transactional email</li></ul>",
    "<p>You can ask for the full list at privacy@antelope.io.</p>",
  ].join(""),
};

/**
 * The migration the playground keeps running: no executor works on it, so
 * dms-saas would mark it interrupted on start (see `keepDemoMigrationRunning`).
 */
export const RUNNING_DEMO_MIGRATION_ID = "migration-growth-to-business";

export const PLAN_MIGRATIONS: SeedPlanMigration[] = [
  {
    id: RUNNING_DEMO_MIGRATION_ID,
    fromPlanId: P.growth2024,
    toPlanId: P.business,
    status: "running",
    tenantIds: [
      W.wayne,
      W.stark,
      W.soylent,
      W.hooli,
      W.aviato,
      W.massiveDynamic,
    ],
    processedWorkspaces: 2,
    failedWorkspaces: [],
    initiatedBy: ADMIN_ID,
    startedOn: 0,
    durationMinutes: null,
  },
  {
    id: "migration-growth-to-team",
    fromPlanId: P.growth2024,
    toPlanId: P.team,
    status: "running",
    tenantIds: [W.hooli, W.piedPiper, W.massiveDynamic, W.aviato, W.vandelay],
    processedWorkspaces: 3,
    failedWorkspaces: [],
    initiatedBy: ADMIN_ID,
    startedOn: 0,
    durationMinutes: null,
  },
  {
    id: "migration-starter-to-team",
    fromPlanId: P.starter,
    toPlanId: P.team,
    status: "reconciliation_required",
    tenantIds: [W.piedPiper, W.globex, W.stark],
    processedWorkspaces: 1,
    failedWorkspaces: [
      {
        tenantId: W.piedPiper,
        error:
          "Stripe did not answer while updating the subscription; its state is uncertain",
      },
      {
        tenantId: W.globex,
        error: "The workspace has no Stripe subscription to move",
      },
    ],
    initiatedBy: ADMIN_ID,
    startedOn: -15,
    durationMinutes: 11,
  },
  {
    id: "migration-growth-to-pro",
    fromPlanId: P.growth2024,
    toPlanId: P.pro,
    status: "partially_failed",
    tenantIds: [W.northwind, W.umbrella, W.initech, W.acme],
    processedWorkspaces: 3,
    failedWorkspaces: [
      { tenantId: W.initech, error: "Your card was declined." },
    ],
    initiatedBy: HUGO_ID,
    startedOn: -34,
    durationMinutes: 4,
  },
  {
    id: "migration-pro-to-business",
    fromPlanId: P.pro,
    toPlanId: P.business,
    status: "completed",
    tenantIds: [W.umbrella, W.northwind],
    processedWorkspaces: 2,
    failedWorkspaces: [],
    initiatedBy: ADMIN_ID,
    startedOn: -38,
    durationMinutes: 22,
  },
  {
    id: "migration-growth-to-starter",
    fromPlanId: P.growth2024,
    toPlanId: P.starter,
    status: "completed",
    tenantIds: [W.piedPiper],
    processedWorkspaces: 1,
    failedWorkspaces: [],
    initiatedBy: SOFIA_ID,
    startedOn: -117,
    durationMinutes: 7,
  },
];

export const SEGMENTS: SeedSegment[] = [
  {
    id: "segment-paying-owners",
    name: "Paying owners",
    description: "Everyone who owns a workspace that pays",
    conditions: {
      logical: "and",
      conditions: [
        { field: "isOwnerOfAnyWorkspace", operator: "eq", value: true },
        {
          kind: "workspaceRef",
          quantifier: "any",
          role: "owner",
          conditions: {
            logical: "and",
            conditions: [{ field: "isPaying", operator: "eq", value: true }],
          },
        },
      ],
    },
  },
  {
    id: "segment-at-risk-paying-owners",
    name: "At-risk paying owners",
    description: "Owners of paying workspaces that are slipping",
    conditions: {
      logical: "and",
      conditions: [
        { field: "isValidated", operator: "eq", value: true },
        {
          kind: "workspaceRef",
          quantifier: "any",
          role: "owner",
          conditions: {
            logical: "and",
            conditions: [
              { field: "isPaying", operator: "eq", value: true },
              {
                logical: "or",
                conditions: [
                  {
                    field: "status",
                    operator: "in",
                    value: ["past_due", "suspended"],
                  },
                  { field: "daysSinceLastInvoice", operator: "gt", value: 35 },
                  { field: "membersCount", operator: "lt", value: 2 },
                ],
              },
            ],
          },
        },
        { field: "daysSinceLastActive", operator: "gt", value: 5 },
      ],
    },
  },
  {
    id: "segment-trials",
    name: "Trials ending in 14 days",
    description: "For the conversion email sequence",
    conditions: {
      logical: "and",
      conditions: [
        {
          kind: "workspaceRef",
          quantifier: "any",
          role: "owner",
          conditions: {
            logical: "and",
            conditions: [{ field: "isOnTrial", operator: "eq", value: true }],
          },
        },
        { field: "ageInDays", operator: "gte", value: 16 },
      ],
    },
  },
  {
    id: "segment-dormant",
    name: "Dormant 30 days",
    description: "Haven't signed in for a month",
    conditions: {
      logical: "and",
      conditions: [{ field: "daysSinceLastActive", operator: "gt", value: 30 }],
    },
  },
  {
    id: "segment-business-eu",
    name: "Business customers · EU",
    description: "VAT-registered companies in the EU",
    conditions: {
      logical: "and",
      conditions: [
        {
          kind: "workspaceRef",
          quantifier: "any",
          role: "member",
          conditions: {
            logical: "and",
            conditions: [
              { field: "customerType", operator: "eq", value: "business" },
            ],
          },
        },
        {
          logical: "or",
          conditions: [
            { field: "language", operator: "eq", value: "fr" },
            { field: "language", operator: "eq", value: "de" },
            { field: "language", operator: "eq", value: "nl" },
          ],
        },
      ],
    },
  },
  {
    id: "segment-internal",
    name: "Internal",
    description: "Antelope staff accounts",
    conditions: {
      logical: "and",
      conditions: [
        { field: "email", operator: "contains", value: "@antelope.io" },
      ],
    },
  },
];

export const PLATFORM_NOTES: SeedPlatformNote[] = [
  {
    id: "note-northwind-seats",
    targetType: "workspace",
    targetId: W.northwind,
    authorId: ADMIN_ID,
    content:
      "Margaux asked for 5 more seats next month; quote Enterprise if they pass 30.",
    writtenOn: -2,
  },
  {
    id: "note-northwind-vat",
    targetType: "workspace",
    targetId: W.northwind,
    authorId: HUGO_ID,
    content:
      "VAT number re-verified after the VIES outage. Last invoice re-sent.",
    writtenOn: -25,
  },
  {
    id: "note-northwind-onboarding",
    targetType: "workspace",
    targetId: W.northwind,
    authorId: SOFIA_ID,
    content: "Onboarding call done. They import their catalogue from Shopify.",
    writtenOn: -560,
  },
  {
    id: "note-initech-dunning",
    targetType: "workspace",
    targetId: W.initech,
    authorId: HUGO_ID,
    content:
      "Bill says the card expired; he will update it before the suspension date.",
    writtenOn: -7,
  },
  {
    id: "note-pied-piper-suspension",
    targetType: "workspace",
    targetId: W.piedPiper,
    authorId: ADMIN_ID,
    content:
      "Suspended after three failed payments. Reactivate as soon as the invoice is paid.",
    writtenOn: -17,
  },
  {
    id: "note-margaux",
    targetType: "user",
    targetId: "user-margaux-dubois",
    authorId: ADMIN_ID,
    content: "Main contact for Northwind. Prefers e-mail in French.",
    writtenOn: -90,
  },
];
