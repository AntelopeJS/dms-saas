export interface InvitationLink {
  link: string;
  expiresAt: string;
}

export interface InvitationRef {
  tenantId: string;
  inviteId: string;
}

const INVITATIONS_ENDPOINT = "/api/saas/workspaces";

/**
 * Retrieves an invitation's signup link (each retrieval is journaled server
 * side) and puts it on the clipboard, reporting the outcome with a toast.
 */
export function useInvitationLink() {
  const { $authFetch } = useAuthFetch();
  const nuxtApp = useDmsApp();
  const toast = useToast();
  const { resolveApiError } = useApiErrorMessage();

  function fetchInvitationLink(ref: InvitationRef): Promise<InvitationLink> {
    return $authFetch<InvitationLink>(
      `${INVITATIONS_ENDPOINT}/${ref.tenantId}/invitations/${ref.inviteId}/link`,
      { method: "POST" },
    );
  }

  /** Returns whether the link reached the clipboard. */
  async function copyLink(link: string): Promise<boolean> {
    const t = nuxtApp.$i18n.t;
    try {
      await navigator.clipboard.writeText(link);
      toast.add({
        title: t("saas.workspaces.invitations.link.copied"),
        color: "success",
        icon: "i-ph-check-circle",
      });
      return true;
    } catch {
      // The clipboard can be refused (permissions, insecure origin): the link
      // stays readable so it can still be copied by hand.
      toast.add({
        title: t("saas.workspaces.invitations.link.copy_failed"),
        description: link,
        color: "warning",
        icon: "i-ph-warning",
        duration: 0,
      });
      return false;
    }
  }

  async function fetchAndCopy(ref: InvitationRef): Promise<void> {
    try {
      const { link } = await fetchInvitationLink(ref);
      await copyLink(link);
    } catch (error) {
      toast.add({
        title: resolveApiError(error, "saas.workspaces.invitations.link.error"),
        color: "error",
        icon: "i-ph-warning-circle",
      });
    }
  }

  return { fetchInvitationLink, copyLink, fetchAndCopy };
}
