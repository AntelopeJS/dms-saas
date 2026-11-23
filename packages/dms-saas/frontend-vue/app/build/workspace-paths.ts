/** Where the workspace settings pages answer, under the DMS's workspace category. */
export const MEMBERS_PATH = '/settings/workspace/members'
export const INVITES_PATH = '/settings/workspace/invites'
export const BILLING_PATH = '/settings/workspace/billing'
export const DATA_EXPORT_PATH = '/settings/workspace/data-export'
export const GENERAL_PATH = '/settings/workspace/general'
/** Where a workspace switch lands: the previous page belonged to the old tenant. */
export const HOME_PATH = '/'

/** What a page declares about itself that a workspace switch reads. */
export interface PageMetadata {
	readonly displayName?: string
	readonly workspaceScoped?: boolean
}

/**
 * Where a workspace switch lands from a page: home when the page belongs to
 * one workspace (it declares `workspaceScoped`), else the current URL.
 *
 * @param metadata What the page declares about itself, if a route matches
 */
export function workspaceSwitchLandingPath(
	metadata: PageMetadata | undefined,
): string | undefined {
	return metadata &&
		Object.hasOwn(metadata, 'workspaceScoped') &&
		metadata.workspaceScoped === true
		? HOME_PATH
		: undefined
}
