export interface InvitationLink {
	link: string
	expiresAt: string
}

export interface InvitationRef {
	tenantId: string
	inviteId: string
}

const INVITATIONS_ENDPOINT = '/api/saas/workspaces'

/**
 * Retrieves an invitation's signup link (each retrieval is journaled server
 * side) and puts it on the clipboard, reporting the outcome with a toast.
 */
export function useInvitationLink() {
	const { $authFetch } = useAuthFetch()
	const nuxtApp = useDmsApp()
	const toast = useToast()

	function fetchInvitationLink(ref: InvitationRef): Promise<InvitationLink> {
		return $authFetch<InvitationLink>(
			`${INVITATIONS_ENDPOINT}/${ref.tenantId}/invitations/${ref.inviteId}/link`,
			{ method: 'POST' },
		)
	}

	/** Returns whether the link reached the clipboard. */
	async function copyLink(link: string): Promise<boolean> {
		const t = nuxtApp.$i18n.t
		let copied: boolean
		try {
			await navigator.clipboard.writeText(link)
			copied = true
		} catch {
			copied = false
		}
		if (copied) {
			toast.add({
				title: t('saas.workspace_detail.invitations.link.copied'),
				color: 'success',
				icon: 'i-ph-check-circle',
			})
			return true
		}
		toast.add({
			title: t('saas.workspace_detail.invitations.link.copy_failed'),
			description: link,
			color: 'warning',
			icon: 'i-ph-warning',
			duration: 0,
		})
		return false
	}

	return { fetchInvitationLink, copyLink }
}
