import { GetModel } from "@antelopejs/interface-database-decorators";
import { RoleModel } from "@antelopejs/interface-dms/db";
import {
  GetPermissions,
  type PermissionTree,
} from "@antelopejs/interface-dms/permissions";

const MEMBER_ROLE_SUFFIX = "member";
const FALLBACK_LANGUAGE = "en";

interface RoleText {
  name: string;
  description: string;
}

/**
 * A role is the workspace's own data, named once in its owner's language
 * and renamed by them at will, so it is written here rather than translated
 * on each read.
 */
const MEMBER_ROLE_TEXTS: Record<string, RoleText> = {
  en: {
    name: "Member",
    description: "Everything the workspace plan includes",
  },
  fr: {
    name: "Membre",
    description: "Tout ce que comprend l'offre de l'espace",
  },
};

/** Tenant rows share one collection, so the role id carries the tenant. */
export function defaultMemberRoleId(tenantId: string): string {
  return `${tenantId}:${MEMBER_ROLE_SUFFIX}`;
}

function memberRoleText(language: string | undefined): RoleText {
  const base = language?.split("-")[0]?.toLowerCase() ?? FALLBACK_LANGUAGE;
  return MEMBER_ROLE_TEXTS[base] ?? MEMBER_ROLE_TEXTS[FALLBACK_LANGUAGE];
}

function collectPermissionIds(tree: Record<string, PermissionTree>): string[] {
  return Object.values(tree).flatMap((node) => [
    ...(node.data ? [node.data.id] : []),
    ...collectPermissionIds(node.children),
  ]);
}

/**
 * Gives a new workspace the role its owner invites with: every permission
 * the DMS grants, which the plan then caps and the owner-only surfaces are
 * withheld from, as the playground seed writes it.
 *
 * @param tenantId The new workspace
 * @param language The owner's language, for the role's name and description
 */
export async function createDefaultMemberRole(
  tenantId: string,
  language: string | undefined,
): Promise<string> {
  const permissions = [
    ...new Set(collectPermissionIds(await GetPermissions())),
  ];
  const now = new Date();
  const [roleId] = await GetModel(RoleModel, tenantId).insert([
    {
      _id: defaultMemberRoleId(tenantId),
      ...memberRoleText(language),
      permissions,
      createdAt: now,
      updatedAt: now,
    },
  ]);
  return roleId;
}
