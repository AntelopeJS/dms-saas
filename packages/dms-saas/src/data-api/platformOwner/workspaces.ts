import { Controller } from "@antelopejs/interface-api";
import {
  DataController,
  RegisterDataController,
} from "@antelopejs/interface-data-api";
import {
  Access,
  AccessMode,
  Joined,
  Listable,
  ModelReference,
  Sortable,
} from "@antelopejs/interface-data-api/metadata";
import { Model } from "@antelopejs/interface-database-decorators";
import { Tenant, TenantModel } from "@antelopejs/interface-dms/db";
import { AuthOwnerOnly } from "@antelopejs/interface-dms/auth";
import {
  type CellSubline,
  Column,
  type ComposedText,
  DefaultDisplays,
  Exported,
  Searchable,
  Select,
  TableViewRoutes,
} from "@antelopejs/interface-dms/base";
import { DefaultDataTypes } from "@antelopejs/interface-dms/base/data-types/default-types";
import { TenantBillingState, WORKSPACE_RENEWAL_KINDS } from "../../db";
import { statusPillDisplay, statusType } from "../../utils/status-vocabulary";
import { HiddenStringFilter } from "./hidden-filter";
import {
  type WorkspaceCellRow,
  workspaceMrrAmount,
  workspaceMrrNote,
  workspaceOwnerLabel,
  workspaceOwnerState,
  workspacePlanDetail,
  workspaceRenewalDate,
  workspaceRenewalSummary,
} from "./workspace-cells";

const COLUMN = "$saas.workspaces.column";

// Every directory field is read off the workspace's billing state row, which
// is keyed by the tenant id: one join per column, sortable and filterable in
// the database.
const DIRECTORY_JOIN = {
  table: TenantBillingState,
  localKey: "_id",
  remoteIndex: "_id",
} as const;

function directoryField(remoteField: string): PropertyDecorator {
  return Joined({ ...DIRECTORY_JOIN, remoteField }) as PropertyDecorator;
}

const RENEWAL_KIND_TYPE = new DefaultDataTypes.SelectType({
  items: WORKSPACE_RENEWAL_KINDS.map((kind) => ({
    label: `$saas.workspaces.renewal_kind.${kind}`,
    value: kind,
  })),
});

/** A directory getter's row: the joined fields are read off the instance. */
function directoryRow(self: unknown): WorkspaceCellRow {
  return self as WorkspaceCellRow;
}

/**
 * Every customer workspace with its directory row: status, plan, MRR, owner
 * and the next date that matters, all stored so they sort and filter.
 */
@RegisterDataController()
@AuthOwnerOnly()
export class workspacesDataAPI extends DataController(
  Tenant,
  {
    get: TableViewRoutes.Get,
    list: TableViewRoutes.List,
    select: TableViewRoutes.Select,
    count: TableViewRoutes.Count,
    countBatch: TableViewRoutes.CountBatch,
  },
  Controller("/api/saas/tables/workspaces"),
) {
  @ModelReference()
  @Model(TenantModel)
  declare model: TenantModel;

  @Select()
  @Listable()
  @Exported()
  @Access(AccessMode.ReadOnly)
  declare _id: string;

  @Select()
  @Listable()
  @Searchable()
  @Exported()
  @Sortable()
  @Column({
    name: `${COLUMN}.workspace`,
    type: new DefaultDataTypes.StringType(),
    filterable: true,
    size: 240,
    display: new DefaultDisplays.IdentityDisplay({ subtitleField: "_id" }),
  })
  @Access(AccessMode.ReadOnly)
  declare name: string;

  @Listable(["_id"])
  @Exported()
  @Sortable({ noIndex: true })
  @Column({
    name: `${COLUMN}.status`,
    type: statusType("workspace"),
    filterable: true,
    display: statusPillDisplay("workspace"),
  })
  @directoryField("billingState")
  @Access(AccessMode.ReadOnly)
  declare billingState: string;

  /** The plan's id, filtered on by the Plans page's "View workspaces" link. */
  @Listable(["_id"])
  @HiddenStringFilter()
  @directoryField("planId")
  @Access(AccessMode.ReadOnly)
  declare planId: string | null;

  @Listable(["_id"])
  @Exported()
  @Sortable({ noIndex: true })
  @Column({
    name: `${COLUMN}.plan`,
    type: new DefaultDataTypes.StringType(),
    filterable: true,
    display: new DefaultDisplays.TwoLineDisplay({ subField: "planDetail" }),
  })
  @directoryField("planName")
  @Access(AccessMode.ReadOnly)
  declare planName: string | null;

  @Listable(["_id"])
  @Exported()
  @Sortable({ noIndex: true })
  @Column({
    name: `${COLUMN}.mrr`,
    type: new DefaultDataTypes.NumberType(),
    filterable: true,
    display: new DefaultDisplays.TwoLineDisplay({
      primaryField: "mrrAmount",
      subField: "mrrNote",
    }),
  })
  @directoryField("mrrMinor")
  @Access(AccessMode.ReadOnly)
  declare mrrMinor: number;

  @Listable(["_id"])
  @Searchable()
  @Exported()
  @Sortable({ noIndex: true })
  @Column({
    name: `${COLUMN}.owner`,
    type: new DefaultDataTypes.StringType(),
    filterable: true,
    display: new DefaultDisplays.TwoLineDisplay({
      primaryField: "ownerLabel",
      subField: "ownerState",
    }),
  })
  @directoryField("ownerName")
  @Access(AccessMode.ReadOnly)
  declare ownerName: string | null;

  @Listable(["_id"])
  @Searchable()
  @Exported()
  @Column({
    name: `${COLUMN}.owner_email`,
    type: new DefaultDataTypes.EmailType(),
    filterable: true,
    isVisible: false,
  })
  @directoryField("ownerEmail")
  @Access(AccessMode.ReadOnly)
  declare ownerEmail: string | null;

  @Listable(["_id"])
  @Exported()
  @Column({
    name: `${COLUMN}.owner_status`,
    type: statusType("owner"),
    filterable: true,
    isVisible: false,
  })
  @directoryField("ownerStatus")
  @Access(AccessMode.ReadOnly)
  declare ownerStatus: string;

  @Listable(["_id"])
  @Column({
    name: `${COLUMN}.owner_never_joined`,
    type: new DefaultDataTypes.BooleanType(),
    filterable: true,
    isVisible: false,
  })
  @directoryField("ownerNeverJoined")
  @Access(AccessMode.ReadOnly)
  declare ownerNeverJoined: boolean;

  @Listable(["_id"])
  @Exported()
  @Sortable({ noIndex: true })
  @Column({
    name: `${COLUMN}.renews`,
    type: new DefaultDataTypes.DateType(),
    filterable: true,
    display: new DefaultDisplays.TwoLineDisplay({
      primaryField: "renewalSummary",
      subField: "renewalDate",
    }),
  })
  @directoryField("renewsAt")
  @Access(AccessMode.ReadOnly)
  declare renewsAt: Date | null;

  @Listable(["_id"])
  @Column({
    name: `${COLUMN}.renewal_kind`,
    type: RENEWAL_KIND_TYPE,
    filterable: true,
    isVisible: false,
  })
  @directoryField("renewalKind")
  @Access(AccessMode.ReadOnly)
  declare renewalKind: string | null;

  @Listable(["_id"])
  @Column({
    name: `${COLUMN}.state_since`,
    type: new DefaultDataTypes.DateType(),
    filterable: true,
    isVisible: false,
  })
  @directoryField("stateSince")
  @Access(AccessMode.ReadOnly)
  declare stateSince: Date | null;

  @Listable(["_id"])
  @Column({
    name: `${COLUMN}.complimentary`,
    type: new DefaultDataTypes.BooleanType(),
    filterable: true,
    isVisible: false,
  })
  @directoryField("isComplimentary")
  @Access(AccessMode.ReadOnly)
  declare isComplimentary: boolean;

  @Listable(["_id"])
  @directoryField("currency")
  @Access(AccessMode.ReadOnly)
  declare currency: string | null;

  @Listable(["_id"])
  @directoryField("planUnitAmountMinor")
  @Access(AccessMode.ReadOnly)
  declare planUnitAmountMinor: number | null;

  @Listable(["_id"])
  @directoryField("planInterval")
  @Access(AccessMode.ReadOnly)
  declare planInterval: string | null;

  @Listable(["_id"])
  @directoryField("planBillingMode")
  @Access(AccessMode.ReadOnly)
  declare planBillingMode: string | null;

  @Listable(["_id"])
  @directoryField("seats")
  @Access(AccessMode.ReadOnly)
  declare seats: number;

  // The two-line cells' texts, written from the directory row: the browser
  // words them in the reader's language.
  @Listable(["_id"])
  @Access(AccessMode.ReadOnly)
  get planDetail(): ComposedText | null {
    return workspacePlanDetail(directoryRow(this));
  }

  @Listable(["_id"])
  @Access(AccessMode.ReadOnly)
  get mrrAmount(): ComposedText | null {
    return workspaceMrrAmount(directoryRow(this));
  }

  @Listable(["_id"])
  @Access(AccessMode.ReadOnly)
  get mrrNote(): CellSubline | null {
    return workspaceMrrNote(directoryRow(this));
  }

  @Listable(["_id"])
  @Access(AccessMode.ReadOnly)
  get ownerLabel(): string | null {
    return workspaceOwnerLabel(directoryRow(this));
  }

  @Listable(["_id"])
  @Access(AccessMode.ReadOnly)
  get ownerState(): CellSubline {
    return workspaceOwnerState(directoryRow(this));
  }

  @Listable(["_id"])
  @Access(AccessMode.ReadOnly)
  get renewalSummary(): ComposedText | null {
    return workspaceRenewalSummary(directoryRow(this));
  }

  @Listable(["_id"])
  @Access(AccessMode.ReadOnly)
  get renewalDate(): CellSubline | null {
    return workspaceRenewalDate(directoryRow(this));
  }

  @Select()
  @Listable()
  @Sortable()
  @Exported()
  @Column({
    name: `${COLUMN}.created_at`,
    type: new DefaultDataTypes.DateType(),
    filterable: true,
  })
  @Access(AccessMode.ReadOnly)
  declare createdAt: Date;
}
