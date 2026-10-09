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
import { CROSS_INSTANCE } from "@antelopejs/interface-database";
import { Model } from "@antelopejs/interface-database-decorators";
import { Tenant } from "@antelopejs/interface-dms/db";
import { AuthOwnerOnly } from "@antelopejs/interface-dms/auth";
import {
  Column,
  DefaultDisplays,
  Exported,
  Searchable,
  Select,
  TableViewRoutes,
} from "@antelopejs/interface-dms/base";
import { DefaultDataTypes } from "@antelopejs/interface-dms/base/data-types/default-types";
import { CreditNote, CreditNoteModel } from "../../db";
import { MoneyCentsType, statusPillDisplay, statusType } from "../../utils";
import {
  CREDIT_NOTE_REASONS,
  creditedInvoiceNumber,
  creditNoteIssuer,
  creditNoteMemo,
  creditNoteReason,
  creditNoteRow,
} from "./credit-note-rows";
import { HiddenStringFilter } from "./hidden-filter";

const COLUMN = "$saas.operator_billing.credit_notes.column";

const REASON_TYPE = new DefaultDataTypes.SelectType({
  items: CREDIT_NOTE_REASONS.map((reason) => ({
    label: `$saas.operator_billing.credit_reasons.${reason}`,
    value: reason,
  })),
});

/** Every workspace's credit notes, for platform admins. */
@RegisterDataController()
@AuthOwnerOnly()
export class creditNotesDataAPI extends DataController(
  CreditNote,
  {
    get: TableViewRoutes.Get,
    list: TableViewRoutes.List,
    select: TableViewRoutes.Select,
    count: TableViewRoutes.Count,
    countBatch: TableViewRoutes.CountBatch,
    ...TableViewRoutes.ExportRoutes,
  },
  Controller("/api/saas/tables/credit-notes"),
) {
  @ModelReference()
  @Model(CreditNoteModel, CROSS_INSTANCE)
  declare model: CreditNoteModel;

  @Select()
  @Listable()
  @Access(AccessMode.ReadOnly)
  declare _id: string;

  @Select()
  @Listable()
  @Searchable()
  @Sortable()
  @Exported()
  @Column({
    name: `${COLUMN}.number`,
    type: new DefaultDataTypes.StringType(),
    display: new DefaultDisplays.IdentityDisplay({
      icon: "i-ph-receipt-x",
      subtitleField: "invoiceNumber",
    }),
    filterable: true,
    size: 190,
  })
  @Access(AccessMode.ReadOnly)
  declare number: string;

  @Select()
  @Listable()
  @HiddenStringFilter()
  @Access(AccessMode.ReadOnly)
  declare _instance: string;

  @Select()
  @Listable()
  @Access(AccessMode.ReadOnly)
  declare invoiceId: string;

  @Listable(["_instance", "invoiceId"])
  @Exported()
  @Access(AccessMode.ReadOnly)
  get invoiceNumber(): PromiseLike<string | null> {
    const row = creditNoteRow(this);
    return creditedInvoiceNumber(row._instance, row.invoiceId);
  }

  @Listable(["_instance"])
  @Searchable()
  @Exported()
  @Sortable({ noIndex: true })
  @Column({
    name: `${COLUMN}.workspace`,
    type: new DefaultDataTypes.StringType(),
    display: new DefaultDisplays.IdentityDisplay(),
    filterable: true,
    size: 180,
  })
  @Joined({ table: Tenant, localKey: "_instance", remoteField: "name" })
  @Access(AccessMode.ReadOnly)
  declare workspaceName: string;

  @Select()
  @Listable()
  @Sortable()
  @Exported()
  @Column({
    name: `${COLUMN}.amount`,
    type: new MoneyCentsType(),
    size: 110,
  })
  @Access(AccessMode.ReadOnly)
  declare amount: number;

  @Select()
  @Listable()
  @Exported()
  @Access(AccessMode.ReadOnly)
  declare currency: string;

  @Select()
  @Listable()
  @Sortable()
  @Exported()
  @Column({
    name: `${COLUMN}.type`,
    type: statusType("credit_note_type"),
    filterable: true,
    size: 150,
  })
  @Access(AccessMode.ReadOnly)
  declare type: string;

  @Select()
  @Listable()
  @Sortable()
  @Exported()
  @Column({
    name: `${COLUMN}.status`,
    type: statusType("credit_note"),
    display: statusPillDisplay("credit_note"),
    filterable: true,
    size: 110,
  })
  @Access(AccessMode.ReadOnly)
  declare status: string;

  @Select()
  @Listable()
  @Access(AccessMode.ReadOnly)
  declare metadata: Record<string, unknown>;

  @Select()
  @Listable()
  @Access(AccessMode.ReadOnly)
  declare memo: string | null;

  @Select()
  @Listable()
  @Access(AccessMode.ReadOnly)
  declare reason: string;

  @Listable(["metadata", "reason"])
  @Exported()
  @Column({
    name: `${COLUMN}.reason`,
    type: REASON_TYPE,
    display: new DefaultDisplays.TwoLineDisplay({ subField: "internalMemo" }),
    size: 260,
  })
  @Access(AccessMode.ReadOnly)
  get reasonCode(): string | null {
    return creditNoteReason(creditNoteRow(this));
  }

  @Listable(["metadata", "memo"])
  @Exported()
  @Access(AccessMode.ReadOnly)
  get internalMemo(): string | null {
    return creditNoteMemo(creditNoteRow(this));
  }

  @Listable(["metadata"])
  @Exported()
  @Column({
    name: `${COLUMN}.issued_by`,
    type: new DefaultDataTypes.StringType(),
    display: new DefaultDisplays.IdentityDisplay({
      emptyLabel: "$saas.operator_billing.credit_notes.automatic",
      emptyIcon: "i-ph-robot",
    }),
    size: 160,
  })
  @Access(AccessMode.ReadOnly)
  get issuedBy(): string | null {
    return creditNoteIssuer(creditNoteRow(this));
  }

  @Select()
  @Listable()
  @Sortable()
  @Exported()
  @Column({
    name: `${COLUMN}.issued_at`,
    type: new DefaultDataTypes.DateType(),
    display: new DefaultDisplays.RelativeDateDisplay({ style: "day" }),
    size: 110,
  })
  @Access(AccessMode.ReadOnly)
  declare issuedAt: Date;

  @Select()
  @Listable()
  @Access(AccessMode.ReadOnly)
  declare refundId: string | null;

  @Select()
  @Listable()
  @Access(AccessMode.ReadOnly)
  declare pdfUrl: string | null;
}
