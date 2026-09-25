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
import { GetModel, Model } from "@antelopejs/interface-database-decorators";
import {
  Tenant,
  TenantMemberModel,
  TenantModel,
} from "@antelopejs/interface-dms/db";
import { AuthOwnerOnly } from "@antelopejs/interface-dms/auth";
import { UserModel } from "@antelopejs/interface-dms/auth/db";
import {
  Column,
  Exported,
  Searchable,
  Select,
  TableViewRoutes,
} from "@antelopejs/interface-dms/base";
import { DefaultDataTypes } from "@antelopejs/interface-dms/base/data-types/default-types";
import { StatusType } from "@antelopejs/interface-dms/base/data-types/status-type";
import {
  PlanModel,
  TenantBillingState,
  TenantSubscriptionModel,
} from "../../db";
import { findPendingOwnerInvite } from "../../workspaces/invitations";

const BILLING_STATE_ITEMS = [
  { label: "$saas.workspaces.billing_state.free", value: "free" },
  { label: "$saas.workspaces.billing_state.active", value: "active" },
  { label: "$saas.workspaces.billing_state.trialing", value: "trialing" },
  { label: "$saas.workspaces.billing_state.past_due", value: "past_due" },
  { label: "$saas.workspaces.billing_state.suspended", value: "suspended" },
  { label: "$saas.workspaces.billing_state.cancelled", value: "cancelled" },
  {
    label: "$saas.workspaces.billing_state.pending_payment",
    value: "pending_payment",
  },
];

const NO_VALUE = "—";

interface TenantRowInstance {
  table: { _id: string };
}

function tenantIdOf(self: unknown): string {
  return (self as TenantRowInstance).table._id;
}

async function memberOwnerEmails(tenantId: string): Promise<string[]> {
  const owners = await GetModel(TenantMemberModel, tenantId).listOwners();
  const userModel = GetModel(UserModel);
  const users = await Promise.all(owners.map((m) => userModel.get(m.userId)));
  return users
    .filter((u): u is NonNullable<typeof u> => !!u)
    .map((u) => u.email);
}

/**
 * Owners who joined, or else the invitee who will own the workspace once they
 * accept: a workspace created for a new account has no member yet. Which of
 * the two it is goes in its own column, whose labels the console translates.
 */
export async function workspaceOwnerLabel(tenantId: string): Promise<string> {
  const emails = await memberOwnerEmails(tenantId);
  if (emails.length > 0) return emails.join(", ");
  const invite = await findPendingOwnerInvite(tenantId);
  return invite?.email ?? NO_VALUE;
}

/** Whether an owner joined the workspace, rather than only being invited. */
export async function hasWorkspaceOwnerJoined(
  tenantId: string,
): Promise<boolean> {
  const owners = await GetModel(TenantMemberModel, tenantId).listOwners();
  return owners.length > 0;
}

@RegisterDataController()
@AuthOwnerOnly()
export class workspacesDataAPI extends DataController(
  Tenant,
  {
    get: TableViewRoutes.Get,
    list: TableViewRoutes.List,
    select: TableViewRoutes.Select,
    count: TableViewRoutes.Count,
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
    name: "$saas.workspaces.column.name",
    type: new DefaultDataTypes.StringType(),
    filterable: true,
  })
  @Access(AccessMode.ReadOnly)
  declare name: string;

  @Listable(["_id"])
  @Exported()
  @Sortable({ noIndex: true })
  @Column({
    name: "$saas.workspaces.column.status",
    type: new DefaultDataTypes.SelectType({ items: BILLING_STATE_ITEMS }),
    filterable: true,
  })
  @Joined({
    table: TenantBillingState,
    localKey: "_id",
    remoteField: "billingState",
    remoteIndex: "_id",
  })
  @Access(AccessMode.ReadOnly)
  declare billingState: string;

  @Listable(["_id"])
  @Exported()
  @Column({
    name: "$saas.workspaces.column.plan",
    type: new DefaultDataTypes.StringType(),
  })
  @Access(AccessMode.ReadOnly)
  get plan(): PromiseLike<string> {
    return GetModel(TenantSubscriptionModel, tenantIdOf(this))
      .findOne()
      .then(async (sub) => {
        if (!sub?.planId) return NO_VALUE;
        const plan = await GetModel(PlanModel).get(sub.planId);
        return plan?.name ?? NO_VALUE;
      });
  }

  @Listable(["_id"])
  @Exported()
  @Column({
    name: "$saas.workspaces.column.owner",
    type: new DefaultDataTypes.StringType(),
  })
  @Access(AccessMode.ReadOnly)
  get owner(): PromiseLike<string> {
    return workspaceOwnerLabel(tenantIdOf(this));
  }

  @Listable(["_id"])
  @Exported()
  @Column({
    name: "$saas.workspaces.column.owner_state",
    type: new StatusType({
      onlineLabel: "$saas.workspaces.owner_state.joined",
      offlineLabel: "$saas.workspaces.owner_state.invited",
      onlineColor: "success",
      offlineColor: "warning",
    }),
  })
  @Access(AccessMode.ReadOnly)
  get ownerJoined(): PromiseLike<boolean> {
    return hasWorkspaceOwnerJoined(tenantIdOf(this));
  }

  @Select()
  @Listable()
  @Sortable()
  @Exported()
  @Column({
    name: "$saas.workspaces.column.created_at",
    type: new DefaultDataTypes.DateType(),
  })
  @Access(AccessMode.ReadOnly)
  declare createdAt: Date;
}
