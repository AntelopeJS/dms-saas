/** Where the workspace settings pages answer, under the DMS's workspace category. */
export const MEMBERS_PATH = '/settings/workspace/members'
export const INVITES_PATH = '/settings/workspace/invites'
export const BILLING_PATH = '/settings/workspace/billing'
export const DATA_EXPORT_PATH = '/settings/workspace/data-export'
export const GENERAL_PATH = '/settings/workspace/general'
/** Where a workspace switch lands: the previous page belonged to the old tenant. */
export const HOME_PATH = '/'

export function workspaceSwitchLandingPath(
	metadata: unknown,
): string | undefined {
	return typeof metadata === 'object' &&
		metadata !== null &&
		Object.hasOwn(metadata, 'workspaceScoped') &&
		'workspaceScoped' in metadata &&
		metadata.workspaceScoped === true
		? HOME_PATH
		: undefined
}
