import { assert } from "@antelopejs/interface-api-util";
import { Logging } from "@antelopejs/interface-core/logging";
import { CROSS_INSTANCE } from "@antelopejs/interface-database";
import { GetModel } from "@antelopejs/interface-database-decorators";
import type { ConfirmDialogSerialized } from "@antelopejs/interface-dms/base";
import { TenantMemberModel, TenantModel } from "@antelopejs/interface-dms/db";
import { type User, UserModel } from "@antelopejs/interface-dms/auth/db";
import { syncSeatsAfterChange } from "../plans";

const HTTP_NOT_FOUND = 404;
const I18N = "$saas.users.platform_role";
const NAME_SEPARATOR = ", ";

/** What changing a user's platform role touches. */
export interface PlatformRoleImpact {
  user: User;
  /** The user is the platform admin asking. */
  isSelf: boolean;
  /** Workspaces the user owns. */
  ownedWorkspaces: string[];
  /**
   * Workspaces the user belongs to without owning them: a platform admin
   * holds no seat there (platform support), anyone else does.
   */
  memberWorkspaces: WorkspaceRef[];
  /** Every workspace of the platform, which a platform admin can manage. */
  workspaceCount: number;
  /** Names of the other platform admins. */
  otherAdmins: string[];
}

/** A workspace by id and name. */
export interface WorkspaceRef {
  tenantId: string;
  name: string;
}

function displayName(user: Pick<User, "name" | "email">): string {
  return user.name || user.email;
}

async function workspacesOf(
  userId: string,
): Promise<{ owned: WorkspaceRef[]; member: WorkspaceRef[] }> {
  const rows = await GetModel(
    TenantMemberModel,
    CROSS_INSTANCE,
  ).listByUserWithTenantIds(userId);
  const tenants = await GetModel(TenantModel).getMany(
    rows.map((row) => row.tenantId),
  );
  const names = new Map(tenants.map((tenant) => [tenant._id, tenant.name]));
  const refs = rows.map((row) => ({
    tenantId: row.tenantId,
    name: names.get(row.tenantId) ?? row.tenantId,
    isOwner: !!row.member.isTenantOwner,
  }));
  const toRef = ({ tenantId, name }: WorkspaceRef) => ({ tenantId, name });
  return {
    owned: refs.filter((ref) => ref.isOwner).map(toRef),
    member: refs.filter((ref) => !ref.isOwner).map(toRef),
  };
}

/**
 * Who the user is to the platform and what a change of their platform role
 * would touch, as seen by `actorId`.
 */
export async function loadPlatformRoleImpact(
  userId: string,
  actorId: string,
): Promise<PlatformRoleImpact> {
  const userModel = GetModel(UserModel);
  const user = await userModel.get(userId);
  assert(user, HTTP_NOT_FOUND, "saas.errors.user.not_found");
  const [workspaces, workspaceCount, admins] = await Promise.all([
    workspacesOf(userId),
    GetModel(TenantModel).table.count().run(),
    userModel.getOwners(),
  ]);
  return {
    user,
    isSelf: userId === actorId,
    ownedWorkspaces: workspaces.owned.map((workspace) => workspace.name),
    memberWorkspaces: workspaces.member,
    workspaceCount,
    otherAdmins: admins
      .filter((admin) => admin._id !== userId)
      .map(displayName),
  };
}

function seatImpactLabel(impact: PlatformRoleImpact, key: string) {
  if (impact.memberWorkspaces.length === 0) return [];
  return [
    {
      icon: "i-ph-armchair",
      label: `${I18N}.${key}`,
      count: impact.memberWorkspaces.map((w) => w.name).join(NAME_SEPARATOR),
    },
  ];
}

/** The confirmation of a promotion: what a platform admin can do. */
export function promoteConfirm(
  impact: PlatformRoleImpact,
): ConfirmDialogSerialized {
  return {
    title: `${I18N}.promote_title`,
    description: `${I18N}.promote_description`,
    params: { name: displayName(impact.user) },
    icon: "i-ph-shield-check",
    color: "primary",
    confirmLabel: `${I18N}.promote_confirm`,
    impact: [
      {
        icon: "i-ph-buildings",
        label: `${I18N}.grants_workspaces`,
        count: impact.workspaceCount,
      },
      { icon: "i-ph-receipt", label: `${I18N}.grants_billing` },
      { icon: "i-ph-package", label: `${I18N}.grants_catalog` },
      { icon: "i-ph-shield-check", label: `${I18N}.grants_admins` },
      ...seatImpactLabel(impact, "frees_seats"),
    ],
  };
}

function blockedDemotion(
  impact: PlatformRoleImpact,
  reason: "self" | "last",
): ConfirmDialogSerialized {
  return {
    title: `${I18N}.demote_blocked_${reason}_title`,
    description: `${I18N}.demote_blocked_${reason}_description`,
    params: { name: displayName(impact.user) },
    icon: "i-ph-shield-warning",
    color: "warning",
    cancelLabel: `${I18N}.close`,
    blocked: true,
  };
}

/**
 * The confirmation of a demotion: what the user loses and who remains — or,
 * for the asking admin or the last one, why it cannot be done.
 */
export function demoteConfirm(
  impact: PlatformRoleImpact,
): ConfirmDialogSerialized {
  if (impact.isSelf) return blockedDemotion(impact, "self");
  if (impact.otherAdmins.length === 0) return blockedDemotion(impact, "last");
  return {
    title: `${I18N}.demote_title`,
    description: `${I18N}.demote_description`,
    params: { name: displayName(impact.user) },
    icon: "i-ph-shield-slash",
    color: "error",
    confirmLabel: `${I18N}.demote_confirm`,
    impact: [
      { icon: "i-ph-prohibit", label: `${I18N}.removes_access` },
      ...seatImpactLabel(impact, "takes_seats"),
      {
        icon: "i-ph-users-three",
        label: `${I18N}.admins_remaining`,
        count: impact.otherAdmins.join(NAME_SEPARATOR),
      },
    ],
  };
}

/**
 * Bring the billed seats of the workspaces the user belongs to without
 * owning them up to date: a platform admin holds no seat there. A failed
 * sync is logged; the next membership change syncs again.
 */
export async function syncSeatsAfterPlatformRoleChange(
  userId: string,
  workspaces: readonly WorkspaceRef[],
): Promise<void> {
  const changedAt = Date.now();
  await Promise.all(
    workspaces.map(({ tenantId }) =>
      syncSeatsAfterChange(
        tenantId,
        `seat-sync:platform-role:${tenantId}:${userId}:${changedAt}`,
      ).catch((error: unknown) => {
        Logging.Error("[dms-saas] seat sync after platform role change", error);
      }),
    ),
  );
}
