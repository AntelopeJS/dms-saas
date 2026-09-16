import {
  Field,
  Index,
  RegisterTable,
  Table,
  UpdateTime,
} from "@antelopejs/interface-database-decorators";
import { TENANT_SCHEMA_NAME } from "@antelopejs/interface-dms/constants";

export const tenantBillingInfoTableName = "tenant_billing_info";

export const TENANT_CUSTOMER_TYPES = ["individual", "business"] as const;
export type TenantCustomerType = (typeof TENANT_CUSTOMER_TYPES)[number];

export const VAT_VERIFICATION_STATUSES = [
  "pending",
  "verified",
  "unverified",
] as const;
export type VatVerificationStatus = (typeof VAT_VERIFICATION_STATUSES)[number];

export interface TenantBillingAddress {
  line1: string | null;
  line2: string | null;
  postalCode: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
}

/** Billing identity and address owned by one tenant. */
@RegisterTable(tenantBillingInfoTableName, TENANT_SCHEMA_NAME)
export class TenantBillingInfo extends Table {
  @Field("string")
  declare _id: string;

  @Field("string")
  declare customerType: TenantCustomerType | null;

  @Field("string")
  declare companyName: string | null;

  @Field("string")
  declare vatNumber: string | null;

  @Field("string")
  declare vatVerificationStatus: VatVerificationStatus | null;

  @Field("string")
  declare billingEmail: string | null;

  @Field("any")
  declare address: TenantBillingAddress | null;

  @Index()
  @UpdateTime()
  @Field("date")
  declare updatedAt: Date;
}
