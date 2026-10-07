import { randomUUID } from "node:crypto";
import { GetModel } from "@antelopejs/interface-database-decorators";
import {
  BILLING_SETTINGS_SINGLETON_ID,
  BillingSettingsModel,
  LEGAL_DOCUMENTS_SINGLETON_ID,
  LegalDocumentsModel,
  type PlanMigrationFeatureDiff,
  PlanMigrationModel,
  type PlanMigrationTenantOutcome,
  PlatformNoteModel,
  SegmentModel,
} from "@antelopejs/interface-dms-saas/db";
import { PLANS } from "../data/catalogue";
import type { SeedBillingSettings, SeedLegalDocuments } from "../data/platform";
import type {
  SeedPlan,
  SeedPlanMigration,
  SeedPlatformNote,
  SeedSegment,
} from "../data/types";
import { addMinutes, dayFrom, insertMissing, type SeedRow } from "./rows";

/** Minutes ago the running migration started. */
const RUNNING_MIGRATION_AGE_MINUTES = -4;

export async function writeBillingSettings(
  settings: SeedBillingSettings,
): Promise<void> {
  await insertMissing(BillingSettingsModel, [
    { _id: BILLING_SETTINGS_SINGLETON_ID, ...settings },
  ]);
}

/**
 * dms-saas creates the legal documents empty on start: they are filled in
 * when still blank, so an operator's own text is never replaced.
 */
export async function writeLegalDocuments(
  documents: SeedLegalDocuments,
): Promise<void> {
  const model = GetModel(LegalDocumentsModel);
  const existing = await model.get(LEGAL_DOCUMENTS_SINGLETON_ID);
  if (!existing) {
    await insertMissing(LegalDocumentsModel, [
      { _id: LEGAL_DOCUMENTS_SINGLETON_ID, ...documents },
    ]);
    return;
  }
  const isBlank =
    !existing.termsOfUse &&
    !existing.termsAndConditions &&
    !existing.privacyPolicy;
  if (isBlank) await model.update(LEGAL_DOCUMENTS_SINGLETON_ID, documents);
}

export async function writeSegments(segments: SeedSegment[]): Promise<void> {
  const rows = segments.map(({ id, ...segment }) => ({
    ...segment,
    _id: id,
    estimatedCount: 0,
    lastEvaluatedAt: null,
  }));
  await insertMissing(SegmentModel, rows);
}

export async function writePlatformNotes(
  notes: SeedPlatformNote[],
): Promise<void> {
  const rows = notes.map(({ id, writtenOn, ...note }) => ({
    ...note,
    _id: id,
    createdAt: dayFrom(writtenOn),
    updatedAt: dayFrom(writtenOn),
  }));
  await insertMissing(PlatformNoteModel, rows);
}

function findPlan(planId: string): SeedPlan {
  const plan = PLANS.find((candidate) => candidate.id === planId);
  if (!plan) throw new Error(`Plan migration names no seeded plan: ${planId}`);
  return plan;
}

function diffFeatures(from: SeedPlan, to: SeedPlan): PlanMigrationFeatureDiff {
  const fromKeys = Object.keys(from.features);
  const toKeys = Object.keys(to.features);
  return {
    removed: fromKeys.filter((key) => !(key in to.features)),
    added: toKeys.filter((key) => !(key in from.features)),
    changed: fromKeys
      .filter(
        (key) => key in to.features && from.features[key] !== to.features[key],
      )
      .map((key) => ({
        key,
        oldValue: from.features[key],
        newValue: to.features[key],
      })),
  };
}

function tenantOutcomes(
  migration: SeedPlanMigration,
): PlanMigrationTenantOutcome[] {
  const failed = migration.failedWorkspaces.map((failure) => failure.tenantId);
  const moved = migration.tenantIds
    .filter((tenantId) => !failed.includes(tenantId))
    .slice(0, migration.processedWorkspaces);
  return [
    ...moved.map((tenantId) => ({
      tenantId,
      status: "succeeded" as const,
      error: null,
      seatQuantity: null,
    })),
    ...migration.failedWorkspaces.map(({ tenantId, error }) => ({
      tenantId,
      status: "reconciliation_required" as const,
      error,
      seatQuantity: null,
    })),
  ];
}

function toMigrationRow(
  migration: SeedPlanMigration,
  permissions: string[],
): SeedRow {
  const target = findPlan(migration.toPlanId);
  const outcomes = tenantOutcomes(migration);
  const startedAt =
    migration.durationMinutes === null
      ? addMinutes(new Date(), RUNNING_MIGRATION_AGE_MINUTES)
      : dayFrom(migration.startedOn);
  const processedTenantIds = outcomes
    .filter((outcome) => outcome.status === "succeeded")
    .map((outcome) => outcome.tenantId);
  return {
    _id: migration.id,
    revision: randomUUID(),
    fromPlanId: migration.fromPlanId,
    toPlanId: migration.toPlanId,
    status: migration.status,
    notifyMembers: true,
    snapshot: {
      tenantIds: migration.tenantIds,
      target: {
        planId: target.id,
        name: target.name,
        billingMode: target.billingMode,
        stripePriceId: target.stripeKey ? `price_1${target.stripeKey}` : null,
        permissions,
      },
    },
    tenantOutcomes: outcomes,
    totalWorkspaces: migration.tenantIds.length,
    processedWorkspaces: processedTenantIds.length,
    processedTenantIds,
    failedWorkspaces: migration.failedWorkspaces,
    initiatedBy: migration.initiatedBy,
    permissionDiff: { removed: [], added: [], unchanged: permissions },
    featureDiff: diffFeatures(findPlan(migration.fromPlanId), target),
    createdAt: startedAt,
    startedAt,
    completedAt:
      migration.durationMinutes === null
        ? null
        : addMinutes(startedAt, migration.durationMinutes),
  };
}

export async function writePlanMigrations(
  migrations: SeedPlanMigration[],
  permissions: string[],
): Promise<void> {
  await insertMissing(
    PlanMigrationModel,
    migrations.map((migration) => toMigrationRow(migration, permissions)),
  );
}
