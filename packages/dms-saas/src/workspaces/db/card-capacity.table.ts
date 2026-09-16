import {
  Field,
  RegisterTable,
  Table,
} from "@antelopejs/interface-database-decorators";
import { CORE_SCHEMA_NAME } from "@antelopejs/interface-dms/constants";

/** A place consumed by a workspace or retained for an uncertain creation. */
export interface CardCapacityAllocation {
  tenantId: string;
  state: "reserved" | "confirmed" | "reconciliation_required";
}

export const cardCapacitiesTableName = "saas_card_capacities";

/** Authoritative per-card free-workspace allocations; reservations never expire. */
@RegisterTable(cardCapacitiesTableName, CORE_SCHEMA_NAME)
export class CardCapacity extends Table {
  @Field("string")
  declare _id: string;

  @Field("string")
  declare revision: string;

  @Field("any")
  declare allocations: CardCapacityAllocation[];
}
