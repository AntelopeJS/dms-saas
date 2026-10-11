import {
  Controller,
  Get,
  HTTPResult,
  JSONBody,
  Parameter,
  Post,
} from "@antelopejs/interface-api";
import { assert } from "@antelopejs/interface-api-util";
import { Logging } from "@antelopejs/interface-core/logging";
import { Model } from "@antelopejs/interface-database-decorators";
import { AuthOwnerOnly } from "@antelopejs/interface-dms/auth";
import type { User } from "@antelopejs/interface-dms/auth/db";
import type {
  ActivityFeedItem,
  BannerContent,
  KeyValueListItem,
  NavCardItem,
  StatGroupItem,
} from "@antelopejs/interface-dms/base";
import type { ConfirmDialogSerialized } from "@antelopejs/interface-dms/base/table-view";
import { type PlanMigration, PlanMigrationModel } from "../../db";
import {
  migrationAbilities,
  migrationTotals,
} from "../../plans/migration-detail";
import {
  attentionState,
  migrationChangeItems,
  migrationHeader,
  migrationJournalItems,
  migrationTotalItems,
} from "../../plans/migration-blocks";
import {
  RECONCILE_NOTE_FIELD,
  reconcileDialog,
  resolveDialog,
  retryDialog,
} from "../../plans/migration-dialogs";
import {
  type MigrationWorkspaceRow,
  filterWorkspaceRows,
  recommendedResolution,
  stripeReadingItems,
} from "../../plans/migration-workspaces";
import {
  CONTENT_LANGUAGE_HEADER,
  requestLocale,
} from "../../utils/content-language";
import {
  type UncertainResolution,
  reconcileMigration,
  resolveUncertainWorkspace,
  retryFailedPlanMigrationWorkspaces,
} from "../../workers";
import {
  loadFeatureNames,
  loadMigrationContext,
  loadWorkspaceRows,
  readStripe,
  uncertainView,
} from "./plan-migration-context";

const HTTP_BAD_REQUEST = 400;
const HTTP_NOT_FOUND = 404;
const HTTP_CONFLICT = 409;
const NOTE_MAX_LENGTH = 500;
const NOTE_REQUIRED = "$saas.errors.migration.note_required";
const RESOLUTIONS = new Set<UncertainResolution>(["moved", "not_moved"]);
const MIGRATIONS_PAGE = "/modules/saas/catalog/plan-migrations";
const MIGRATIONS_API = "/api/saas/plan-migrations";
const URLS = { api: MIGRATIONS_API, list: MIGRATIONS_PAGE };
const TEXTS = "$saas.catalog.migrations";

/** The Stripe check drawer: the reading, and what it tells the operator to do. */
interface StripeReadingPayload extends ItemsPayload<KeyValueListItem> {
  resolution: UncertainResolution | null;
  stripeUrl: string | null;
}

interface ItemsPayload<T> {
  items: T[];
}

/** What a source table reads from its route. */
interface RowsPayload<T> {
  results: T[];
  total: number;
}

interface ResolveBody {
  resolution?: string;
}

interface ReconcileBody {
  note?: string;
}

function assertResolution(value: unknown): UncertainResolution {
  const resolution = value as UncertainResolution;
  assert(
    RESOLUTIONS.has(resolution),
    HTTP_BAD_REQUEST,
    "saas.errors.migration.invalid_resolution",
  );
  return resolution;
}

/**
 * Reads, settles, retries and closes plan migrations: every block of a
 * migration's detail page reads its route here, and every action it offers
 * posts here.
 */
export class SaasPlanMigrationsController extends Controller(MIGRATIONS_API) {
  @Model(PlanMigrationModel)
  declare planMigrationModel: PlanMigrationModel;

  private async load(id: string): Promise<PlanMigration> {
    const migration = await this.planMigrationModel.get(id);
    assert(migration, HTTP_NOT_FOUND, "saas.errors.migration.not_found");
    return migration;
  }

  private async context(id: string) {
    return loadMigrationContext(await this.load(id));
  }

  /** One card per migration waiting for an operator, for the list's head. */
  @Get("/attention")
  async attention(
    @AuthOwnerOnly() _user: User,
  ): Promise<ItemsPayload<NavCardItem>> {
    const migrations =
      await this.planMigrationModel.findByStage("needs_attention");
    return { items: migrations.map(attentionCard) };
  }

  @Get("/:id/header")
  async header(
    @AuthOwnerOnly() _user: User,
    @Parameter("id") id: string,
  ): Promise<BannerContent> {
    return migrationHeader(await this.context(id), URLS);
  }

  @Get("/:id/totals")
  async totals(
    @AuthOwnerOnly() _user: User,
    @Parameter("id") id: string,
  ): Promise<ItemsPayload<StatGroupItem>> {
    return { items: migrationTotalItems(await this.context(id)) };
  }

  /** The captured workspaces; `filter_group=is:attention` for the tab. */
  @Get("/:id/workspaces")
  async workspaces(
    @AuthOwnerOnly() _user: User,
    @Parameter("id") id: string,
    @Parameter("filter_group", "query") group: unknown,
  ): Promise<RowsPayload<MigrationWorkspaceRow>> {
    const rows = await loadWorkspaceRows(await this.context(id));
    const results = filterWorkspaceRows(
      rows,
      typeof group === "string" ? group : null,
    );
    return { results, total: results.length };
  }

  @Get("/:id/changes")
  async changes(
    @AuthOwnerOnly() _user: User,
    @Parameter("id") id: string,
    @Parameter(CONTENT_LANGUAGE_HEADER, "header") language: unknown,
  ): Promise<ItemsPayload<KeyValueListItem>> {
    const [context, names] = await Promise.all([
      this.context(id),
      loadFeatureNames(requestLocale(language)),
    ]);
    return { items: migrationChangeItems(context, names) };
  }

  @Get("/:id/journal")
  async journal(
    @AuthOwnerOnly() _user: User,
    @Parameter("id") id: string,
  ): Promise<ItemsPayload<ActivityFeedItem>> {
    return { items: migrationJournalItems(await this.context(id)) };
  }

  /**
   * What Stripe and the DMS each say about a workspace, read now, with the
   * settlement it points to and where to check it in Stripe.
   */
  @Get("/:id/workspaces/:tenantId/stripe")
  async stripeReading(
    @AuthOwnerOnly() _user: User,
    @Parameter("id") id: string,
    @Parameter("tenantId") tenantId: string,
  ): Promise<StripeReadingPayload> {
    const reading = await readStripe(await this.load(id), tenantId);
    return {
      items: stripeReadingItems(reading),
      resolution: recommendedResolution(reading),
      stripeUrl: reading.stripeUrl,
    };
  }

  @Get("/:id/dialogs/retry")
  async retryConfirmation(
    @AuthOwnerOnly() _user: User,
    @Parameter("id") id: string,
  ): Promise<ConfirmDialogSerialized> {
    return retryDialog(await this.context(id));
  }

  @Get("/:id/dialogs/reconcile")
  async reconcileConfirmation(
    @AuthOwnerOnly() _user: User,
    @Parameter("id") id: string,
  ): Promise<ConfirmDialogSerialized> {
    return reconcileDialog(await this.context(id));
  }

  /** "Mark Pied Piper as moved?", with Stripe's reading taken now. */
  @Get("/:id/workspaces/:tenantId/dialogs/:resolution")
  async resolveConfirmation(
    @AuthOwnerOnly() _user: User,
    @Parameter("id") id: string,
    @Parameter("tenantId") tenantId: string,
    @Parameter("resolution") resolution: string,
  ): Promise<ConfirmDialogSerialized> {
    const kind = assertResolution(resolution);
    const context = await this.context(id);
    const view = uncertainView(context, tenantId);
    const reading = await readStripe(context.migration, tenantId);
    return resolveDialog(context, view, kind, reading);
  }

  @Post("/:id/workspaces/:tenantId/resolve")
  async resolve(
    @AuthOwnerOnly() user: User,
    @Parameter("id") id: string,
    @Parameter("tenantId") tenantId: string,
    @JSONBody() body: ResolveBody,
  ): Promise<{ _id: string }> {
    await resolveUncertainWorkspace({
      migrationId: id,
      tenantId,
      resolution: assertResolution(body.resolution),
      operatorId: user._id,
    });
    return { _id: id };
  }

  /** Moves again the workspaces known not to have moved. */
  @Post("/:id/retry")
  async retry(
    @AuthOwnerOnly() _user: User,
    @Parameter("id") id: string,
  ): Promise<{ _id: string }> {
    const migration = await this.load(id);
    const abilities = migrationAbilities(migration, migrationTotals(migration));
    assert(
      abilities.canRetry,
      HTTP_CONFLICT,
      "saas.errors.migration.nothing_to_retry",
    );
    void retryFailedPlanMigrationWorkspaces(id).catch((error: unknown) => {
      Logging.Error(`Plan migration retry ${id} requires inspection`, error);
    });
    return { _id: id };
  }

  /** Closes a migration, its remaining workspaces kept on the source plan. */
  @Post("/:id/reconcile")
  async reconcile(
    @AuthOwnerOnly() user: User,
    @Parameter("id") id: string,
    @JSONBody() body: ReconcileBody,
  ): Promise<{ _id: string }> {
    const note = (body.note ?? "").trim();
    if (!note || note.length > NOTE_MAX_LENGTH) {
      throw new HTTPResult(HTTP_BAD_REQUEST, {
        message: NOTE_REQUIRED,
        field: RECONCILE_NOTE_FIELD,
      });
    }
    await reconcileMigration({ migrationId: id, operatorId: user._id, note });
    return { _id: id };
  }
}

function attentionCard(migration: PlanMigration): NavCardItem {
  const totals = migrationTotals(migration);
  return {
    id: migration._id,
    title: `${migration.fromPlanName} → ${migration.toPlanName}`,
    description:
      totals.uncertain > 0
        ? `${TEXTS}.attention.uncertain`
        : `${TEXTS}.attention.failed`,
    icon: "i-ph-warning-circle",
    iconTone: totals.uncertain > 0 ? "error" : "warning",
    to: `${MIGRATIONS_PAGE}/${migration._id}`,
    state: attentionState(totals),
    stateTone: totals.uncertain > 0 ? "error" : "warning",
  };
}
